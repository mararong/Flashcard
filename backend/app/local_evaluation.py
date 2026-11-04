"""Local-only Ollama batch evaluation and portable public evaluation records."""
import hashlib
import json
import math
import sqlite3
from pathlib import Path
from urllib.parse import urlparse

import httpx
from . import config
from .catalog_filter import POLICY_VERSION, word_reason
from .db import connect, now, sync_public_card
from .difficulty import (ensure_model, evaluate_group, frequency_score, level_for,
                         load_rubric, validate_ai)

CATALOG = config.ROOT / 'frontend/public/dictionary/wordnet.sqlite3'
FIELDS = ('word','pos','model','rubric_version','source_version','evaluated_at',
          'status','error','zipf','frequency_score','scores_json','reasons_json',
          'total','level','review_status','metadata_json')
KEY = ('word','pos','model','rubric_version','source_version')


def catalog_groups(path=CATALOG):
    """Read the shipped, filtered corpus, preserving definition order for cache keys."""
    with sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro', uri=True) as db:
        db.row_factory=sqlite3.Row
        rows=db.execute('SELECT * FROM words ORDER BY rowid').fetchall()
    groups={}
    for row in rows:
        if word_reason(row['word']) or row['filter_version']!=POLICY_VERSION:
            raise ValueError('공용 사전의 필터 정책이 현재 코드와 일치하지 않습니다.')
        key=(row['word'],row['pos'],row['source_version'])
        group=groups.setdefault(key,{'definitions':[], 'senses':[], 'zipf':row['zipf']})
        group['definitions'].append(row['definition']);group['senses'].append(dict(row))
    for (word,pos,version),group in groups.items():
        expected='3.0:'+POLICY_VERSION+':'+hashlib.sha256(json.dumps(group['definitions']).encode()).hexdigest()[:12]
        if version!=expected:
            raise ValueError(f'사전 원본 버전/정의 해시 불일치: {word}/{pos}')
    return groups


def seed_groups(groups):
    """Only public source rows; personal notebooks, cards and history are untouched."""
    with connect() as db:
        for (word,pos,version),group in groups.items():
            for sense in group['senses']:
                db.execute('''INSERT INTO dictionary_senses(word,pos,definition,sense_key,source,source_version)
                  VALUES (?,?,?,?,'wordnet',?) ON CONFLICT(source,sense_key) DO UPDATE SET
                  definition=excluded.definition,
                  level=CASE WHEN source_version!=excluded.source_version THEN NULL ELSE level END,
                  review_status=CASE WHEN source_version!=excluded.source_version THEN 'pending' ELSE review_status END,
                  source_version=excluded.source_version''',
                  (word,pos,sense['definition'],word+':'+sense['sense_key'],version))


def validate_local_url(url):
    parsed=urlparse(url)
    if (parsed.scheme!='http' or parsed.hostname not in ('localhost','127.0.0.1','::1')
        or parsed.port!=11434 or parsed.username or parsed.password or parsed.path not in ('','/')
        or parsed.query or parsed.fragment):
        raise ValueError('로컬 Ollama만 사용합니다. OLLAMA_URL=http://localhost:11434로 설정하세요.')


def run_batch(model, limit=None, timeout=180, client=None, progress=print):
    if not model.strip():raise ValueError('OLLAMA_MODEL 환경변수에 설치된 모델명을 지정하세요.')
    validate_local_url(config.OLLAMA_URL)
    groups=catalog_groups()
    if limit is not None:
        words=list(dict.fromkeys(key[0] for key in groups))[:limit]
        groups={key:g for key,g in groups.items() if key[0] in words}
    seed_groups(groups)
    _,rubric=load_rubric()
    counts={'evaluated':0,'reused':0,'failed':0,'frequency_review':0}
    # Probe only when there is unfinished work; a fully cached run works offline.
    with connect() as db:
        cached={(r['word'],r['pos'],r['source_version']) for r in db.execute(
            "SELECT * FROM evaluations WHERE model=? AND rubric_version=? AND status IN ('complete','frequency_review')",(model,rubric))}
    pending=[key for key in groups if key not in cached]
    own=client is None
    if pending and own:client=httpx.Client(timeout=timeout,trust_env=False)
    try:
        if pending:ensure_model(client,model)
        for index,(key,group) in enumerate(groups.items(),1):
            if key in cached:status='reused'
            else:status=evaluate_group(*key,group['definitions'],model,client)
            counts['evaluated' if status=='complete' else status]+=1
            progress(f'{index}/{len(groups)} {key[0]}/{key[1]}: {status}', flush=True)
    finally:
        if own and client is not None:client.close()
    return counts


def export_results(path,model):
    if not model:raise ValueError('내보낼 OLLAMA_MODEL을 지정하세요.')
    allowed=set(catalog_groups());_,rubric=load_rubric()
    with connect() as db:
        records=[{f:r[f] for f in FIELDS} for r in db.execute(
            'SELECT * FROM evaluations WHERE model=? AND rubric_version=? ORDER BY id',(model,rubric))
            if (r['word'],r['pos'],r['source_version']) in allowed]
    payload={'format':'word-garden-public-evaluations','version':1,'exported_at':now(),'evaluations':records}
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
    return len(records)


def validated_record(record,groups):
    if not isinstance(record,dict) or set(record)!=set(FIELDS):raise ValueError('평가 레코드 형식이 올바르지 않습니다.')
    key=tuple(record.get(k) for k in ('word','pos','source_version'))
    if key not in groups:raise ValueError('현재 필터/사전 버전과 다른 평가입니다. 같은 버전의 프로젝트를 사용하세요.')
    settings,rubric=load_rubric()
    if record['rubric_version']!=rubric:raise ValueError('평가 기준 버전이 다릅니다.')
    for name in ('model','evaluated_at','metadata_json'):
        if not isinstance(record[name],str) or not record[name].strip():raise ValueError(f'{name}이 필요합니다.')
    from datetime import datetime
    datetime.fromisoformat(record['evaluated_at'])
    if not isinstance(json.loads(record['metadata_json']),dict):raise ValueError('메타데이터가 올바르지 않습니다.')
    if record['review_status'] not in ('pending','approved','rejected','automatic'):raise ValueError('검수 상태가 올바르지 않습니다.')
    if record['status'] not in ('complete','failed','frequency_review'):raise ValueError('평가 상태가 올바르지 않습니다.')
    zipf=record['zipf']
    if type(zipf) not in (int,float) or not math.isfinite(zipf) or zipf<0:raise ValueError('Zipf가 올바르지 않습니다.')
    # Evaluate frequency from the locally installed, pinned wordfreq, never trust the packet.
    from .difficulty import calculate_frequency
    expected_zipf,expected_freq=calculate_frequency(record['word'],settings)
    if zipf!=expected_zipf or record['frequency_score']!=expected_freq:raise ValueError('빈도 점수가 현재 wordfreq/기준과 다릅니다.')
    if record['status'] in ('complete','frequency_review'):
        scores,_=validate_ai({'scores':json.loads(record['scores_json']),'reasons':json.loads(record['reasons_json'])})
        total=expected_freq+sum(scores.values()) if expected_freq is not None else None
        level=level_for(total) if total is not None else None
        if total is not None and (type(record['total']) is not int or type(record['level']) is not int or type(record['frequency_score']) is not int):
            raise ValueError('점수와 레벨은 정수여야 합니다.')
        if (record['total']!=total or record['level']!=level or
            (record['status']=='complete')!=(level is not None)):
            raise ValueError('합계/레벨/처리 상태가 평가 기준과 다릅니다.')
    elif any(record[n] is not None for n in ('scores_json','reasons_json','total','level')):
        raise ValueError('실패한 평가에는 정상 점수나 레벨을 넣을 수 없습니다.')
    if record['review_status']=='approved' and record['status']!='complete':raise ValueError('미완료 평가는 승인할 수 없습니다.')
    return record


def import_results(path):
    payload=json.loads(Path(path).read_text(encoding='utf-8-sig'))
    if not isinstance(payload,dict) or payload.get('format')!='word-garden-public-evaluations' or payload.get('version')!=1:
        raise ValueError('지원하지 않는 공용 평가 파일입니다.')
    records=payload.get('evaluations')
    if not isinstance(records,list):raise ValueError('evaluations 목록이 필요합니다.')
    groups=catalog_groups()
    records=[validated_record(r,groups) for r in records]  # validate everything before mutation
    keys=[tuple(r[k] for k in KEY) for r in records]
    if len(set(keys))!=len(keys):raise ValueError('중복 평가 키가 포함되어 있습니다.')
    seed_groups(groups)
    inserted=skipped=0
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        for r in records:
            old=db.execute('SELECT * FROM evaluations WHERE word=? AND pos=? AND model=? AND rubric_version=? AND source_version=?',tuple(r[k] for k in KEY)).fetchone()
            if old and old['status']=='complete':
                if any(old[f]!=r[f] for f in ('scores_json','reasons_json','total','level')) and r['status']=='complete':
                    raise ValueError('완료된 평가와 점수가 충돌합니다. 기존 결과는 덮어쓰지 않았습니다.')
                if r['status']=='complete' and old['review_status'] in ('pending','automatic') and r['review_status'] in ('approved','rejected'):
                    db.execute('UPDATE evaluations SET review_status=? WHERE id=?',(r['review_status'],old['id']))
                    reflect_review(db,r)
                skipped+=1;continue
            if old:
                db.execute('UPDATE evaluations SET '+','.join(f+'=?' for f in FIELDS)+' WHERE id=?',(*tuple(r[f] for f in FIELDS),old['id']))
            else:
                db.execute('INSERT INTO evaluations('+','.join(FIELDS)+') VALUES ('+','.join('?' for _ in FIELDS)+')',tuple(r[f] for f in FIELDS))
            inserted+=1
            reflect_review(db,r)
    # Import retains review state; catalog publication is a separate explicit build step.
    return {'imported':inserted,'skipped':skipped}


def reflect_review(db,record):
    if record['status']!='complete' or record['review_status'] not in ('approved','rejected'):return
    senses=db.execute("SELECT * FROM dictionary_senses WHERE word=? AND pos=? AND source_version=? AND source='wordnet'",
                      (record['word'],record['pos'],record['source_version'])).fetchall()
    for sense in senses:
        db.execute("UPDATE dictionary_senses SET classification_kind='ai',level=?,review_status=? WHERE id=?",
                   (record['level'],record['review_status'],sense['id']))
        if record['review_status']=='approved':sync_public_card(db,sense)


def publish_results(model):
    """Build Pages artifacts from imported SQLite results. No Ollama or corpus access."""
    if not model:raise ValueError('공개할 OLLAMA_MODEL 환경변수를 지정하세요.')
    groups=catalog_groups();_,rubric=load_rubric()
    with connect() as db:
        records=[dict(r) for r in db.execute("SELECT * FROM evaluations WHERE model=? AND rubric_version=? AND status='complete' AND review_status='approved'",(model,rubric))]
    approved={}
    for record in records:
        clean={f:record[f] for f in FIELDS}
        validated_record(clean,groups)
        approved[(record['word'],record['pos'],record['source_version'])]=record
    rows=[]
    for key,group in groups.items():
        evaluation=approved.get(key)
        for sense in group['senses']:
            row={**sense,'model':model,'rubric_version':rubric,'level':None,'total':None,'scores':None,'reasons':None,'status':'pending_ai_review'}
            if evaluation:
                row.update(level=evaluation['level'],total=evaluation['total'],frequency_score=evaluation['frequency_score'],
                           scores=json.loads(evaluation['scores_json']),reasons=json.loads(evaluation['reasons_json']),status='approved')
            rows.append(row)
    from . import config as cfg
    destination=cfg.ROOT/'frontend/public/dictionary'
    columns=list(rows[0]) if rows else []
    # Keep the existing portable corpus schema and stable source identifiers.
    with sqlite3.connect(CATALOG) as db:
        schema=db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='words'").fetchone()[0]
        columns=[r[1] for r in db.execute('PRAGMA table_info(words)')]
    temporary=CATALOG.with_suffix('.tmp.sqlite3')
    if temporary.exists():temporary.unlink()
    with sqlite3.connect(temporary) as db:
        db.execute(schema)
        db.executemany('INSERT INTO words('+','.join(columns)+') VALUES ('+','.join('?' for _ in columns)+')',
          [tuple(json.dumps(row[c]) if c in ('scores','reasons') else row[c] for c in columns) for row in rows])
    encoded=json.dumps(rows,ensure_ascii=False,separators=(',',':'))
    manifest_path=destination/'report.json'
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest.update(catalog_version=hashlib.sha256(encoded.encode()).hexdigest(),approved=sum(r['level'] is not None for r in rows))
    for target,content in [(cfg.ROOT/'frontend/src/wordnet.json',encoded),(manifest_path,json.dumps(manifest,indent=2)+'\n')]:
        temp=target.with_suffix(target.suffix+'.tmp');temp.write_text(content,encoding='utf-8');temp.replace(target)
    temporary.replace(CATALOG)
    return {'approved_senses':manifest['approved'],'model':model}
