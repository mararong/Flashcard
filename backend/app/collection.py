"""Resumable WordNet discovery and rubric-based local AI classification."""
import re
import sqlite3
import uuid
from itertools import zip_longest

import httpx

from . import config
from .db import connect, now
from .dictionary import collect_word, wordnet_available
from .difficulty import (apply_evaluation, calculate_frequency, ensure_model,
                         evaluate_group, load_rubric, refresh_frequency)


def recover_jobs():
    with connect() as db:
        db.execute("""UPDATE collection_jobs SET status='interrupted', phase='종료됨',
          error='서버가 재시작되었습니다. 다시 수집하면 저장된 결과부터 이어서 처리합니다.',
          finished_at=? WHERE status IN ('queued','running')""", (now(),))


def latest_job():
    with connect() as db:
        row = db.execute('SELECT * FROM collection_jobs ORDER BY created_at DESC LIMIT 1').fetchone()
    return dict(row) if row else None


def create_job(limit):
    if type(limit) is not int or not 1 <= limit <= 500:
        raise ValueError('수집 단어 수는 1~500 사이여야 합니다.')
    if not config.OLLAMA_MODEL:
        raise ValueError('Ollama 모델을 준비하고 .env의 OLLAMA_MODEL을 설정해 주세요.')
    _, rubric = load_rubric()
    job_id = str(uuid.uuid4())
    try:
        with connect() as db:
            db.execute('''INSERT INTO collection_jobs
              (id,status,phase,requested,model,rubric_version,created_at)
              VALUES (?,'queued','준비 중',?,?,?,?)''',
                       (job_id, limit, config.OLLAMA_MODEL, rubric, now()))
    except sqlite3.IntegrityError as exc:
        raise ValueError('이미 단어를 수집하고 있습니다. 진행 중인 작업을 확인해 주세요.') from exc
    return job_id


def update_job(job_id, **changes):
    # Column names are internal constants, never client input.
    with connect() as db:
        db.execute('UPDATE collection_jobs SET '+','.join(f'{key}=?' for key in changes)+' WHERE id=?',
                   (*changes.values(), job_id))


def discover_words(limit, model, rubric):
    """Retry unfinished lemmas first, then interleave common/general/rarer words."""
    from nltk.corpus import wordnet as wn
    source_version = wn.get_version()
    with connect() as db:
        unfinished = [r['word'] for r in db.execute('''SELECT DISTINCT d.word
          FROM dictionary_senses d LEFT JOIN evaluations e
          ON e.word=d.word AND e.pos=d.pos AND e.source_version=d.source_version
          AND e.model=? AND e.rubric_version=?
          WHERE d.source='wordnet' AND d.source_version=?
          AND (e.id IS NULL OR e.status='failed' OR (e.status='complete' AND e.review_status='pending'))
          ORDER BY d.word''', (model, rubric, source_version))]
        existing = {r[0] for r in db.execute(
            "SELECT DISTINCT word FROM dictionary_senses WHERE source='wordnet' AND source_version=?",
            (source_version,))}
    selected = unfinished[:limit]
    if len(selected) == limit:
        return selected
    buckets = [[], [], []]
    for word in set(wn.all_lemma_names()):
        # Exclude proper names, compounds and unobserved/extremely rare spellings.
        if word in existing or not re.fullmatch('[a-z]{2,24}', word):
            continue
        zipf, _ = calculate_frequency(word)
        if zipf < 2:
            continue
        bucket = 0 if zipf >= 5 else 1 if zipf >= 3.5 else 2
        buckets[bucket].append((-zipf, word))
    for bucket in buckets:
        bucket.sort()
    def ordinary_words(bucket):
        for _, word in bucket:
            # WordNet's index lowercases proper names too (e.g. London).
            if any(lemma.name() == word for lemma in wn.lemmas(word)):
                yield word

    for trio in zip_longest(*(ordinary_words(bucket) for bucket in buckets)):
        for word in trio:
            if word:
                selected.append(word)
                if len(selected) == limit:
                    return selected
    return selected


def run_job(job_id, report=None):
    with connect() as db:
        row = db.execute('SELECT * FROM collection_jobs WHERE id=?', (job_id,)).fetchone()
    if not row or row['status'] != 'queued':
        return
    job = dict(row)
    counters = {key: 0 for key in ('collected','senses','total_groups','evaluated','reused',
                                  'failed','frequency_review','published')}

    def progress(phase, word=None):
        update_job(job_id, phase=phase, current_word=word, **counters)
        if report:
            report({'phase': phase, 'current_word': word, **counters})

    try:
        update_job(job_id, status='running')
        with httpx.Client(timeout=180, trust_env=False) as client:
            progress('Ollama 연결 확인')
            ensure_model(client, job['model'])
            if not wordnet_available():
                progress('WordNet 다운로드 및 검증')
                from scripts.prepare_wordnet import prepare_wordnet
                prepare_wordnet()
            progress('WordNet 단어 자동 선정')
            words = discover_words(job['requested'], job['model'], job['rubric_version'])
            groups = {}
            for word in words:
                progress('단어·뜻 수집', word)
                counters['senses'] += collect_word(word)
                refresh_frequency(word)
                with connect() as db:
                    senses = db.execute("SELECT * FROM dictionary_senses WHERE word=? AND source='wordnet'",
                                        (word,)).fetchall()
                for sense in senses:
                    key = (sense['word'], sense['pos'], sense['source_version'])
                    groups.setdefault(key, []).append(sense['definition'])
                counters['collected'] += 1
            counters['total_groups'] = len(groups)
            for (word, pos, source_version), definitions in groups.items():
                if load_rubric()[1] != job['rubric_version']:
                    raise ValueError('분류 기준이 변경되었습니다. 다시 수집해 새 기준으로 평가해 주세요.')
                progress('난이도 평가', f'{word}/{pos}')
                result = evaluate_group(word, pos, source_version, definitions, job['model'], client)
                counters['evaluated'] += 1
                counters['reused'] += result == 'reused'
                with connect() as db:
                    evaluation = db.execute('''SELECT * FROM evaluations WHERE word=? AND pos=?
                      AND source_version=? AND model=? AND rubric_version=?''',
                        (word, pos, source_version, job['model'], job['rubric_version'])).fetchone()
                if evaluation['status'] == 'complete':
                    counters['published'] += apply_evaluation(evaluation['id'], 'automatic')
                elif evaluation['status'] == 'frequency_review':
                    counters['frequency_review'] += 1
                else:
                    counters['failed'] += 1
            progress('완료')
            update_job(job_id, status='partial' if counters['failed'] else 'complete', finished_at=now(),
                       error=f"{counters['failed']}개 평가 실패. 다시 수집하면 재시도합니다." if counters['failed'] else None)
    except Exception as exc:
        update_job(job_id, status='failed', phase='실패', error=str(exc)[:1000],
                   finished_at=now(), **counters)


def collection_status():
    with connect() as db:
        counts = dict(db.execute('''SELECT COUNT(DISTINCT word) words, COUNT(*) senses,
          COALESCE(SUM(level IS NOT NULL AND review_status IN ('automatic','approved')),0) classified
          FROM dictionary_senses WHERE source='wordnet' ''').fetchone())
    return {'job': latest_job(), 'counts': counts, 'model': config.OLLAMA_MODEL or None}
