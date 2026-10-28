from types import SimpleNamespace

import pytest

from app import collection, config, dictionary, difficulty
from app.db import connect
from .conftest import add
from .test_difficulty import PAYLOAD


@pytest.fixture
def pipeline(client, monkeypatch):
    monkeypatch.setattr(config, 'OLLAMA_MODEL', 'test')
    monkeypatch.setattr(collection, 'ensure_model', lambda *args: None)
    monkeypatch.setattr(collection, 'wordnet_available', lambda: True)
    monkeypatch.setattr(collection, 'discover_words', lambda *args: ['apple', 'resilience'])
    monkeypatch.setattr(dictionary, 'wordnet_entries', lambda word: [
        (word, 'n', f'Definition of {word}', f'{word}:test.n.01', '3.0')])
    monkeypatch.setattr(difficulty, 'ask_ollama', lambda *args: PAYLOAD)
    return client


def test_pipeline_collects_classifies_publishes_and_reuses(pipeline, book):
    personal = add(pipeline, book)
    response = pipeline.post('/api/dictionary/collection', json={'limit': 2})
    assert response.status_code == 202
    state = pipeline.get('/api/dictionary/collection').json()
    assert state['job']['status'] == 'complete'
    assert state['job']['collected'] == 2
    assert state['job']['published'] == 2
    assert state['counts'] == {'words': 2, 'senses': 2, 'classified': 2}
    cards = [card for level in (1, 2, 3) for card in
             pipeline.get(f'/api/levels/{level}/cards?category=ai').json()]
    assert {c['word'] for c in cards} == {'apple', 'resilience'}
    assert all(c['classification_kind'] == 'ai_auto' and c['review_status'] == 'automatic' for c in cards)
    assert pipeline.get(f'/api/notebooks/{book}').json()['cards'][0]['id'] == personal
    study = pipeline.post('/api/study', json={'source': {'kind': 'level', 'level': cards[0]['level'], 'category': 'ai'}})
    assert study.status_code == 201
    assert pipeline.post('/api/dictionary/collection', json={'limit': 2}).status_code == 202
    assert pipeline.get('/api/dictionary/collection').json()['job']['reused'] == 2
    with connect() as db:
        assert db.execute('SELECT COUNT(*) FROM evaluations').fetchone()[0] == 2
        assert db.execute("SELECT COUNT(*) FROM cards WHERE kind='public' AND dictionary_id IN (SELECT id FROM dictionary_senses WHERE source='wordnet')").fetchone()[0] == 2


def test_manual_rejection_is_not_overridden(pipeline):
    pipeline.post('/api/dictionary/collection', json={'limit': 2})
    with connect() as db:
        row = db.execute("SELECT id FROM evaluations WHERE word='apple'").fetchone()
    difficulty.review_evaluation(row['id'], False)
    pipeline.post('/api/dictionary/collection', json={'limit': 2})
    cards = [c for n in (1, 2, 3) for c in pipeline.get(f'/api/levels/{n}/cards?category=ai').json()]
    assert {c['word'] for c in cards} == {'resilience'}


def test_invalid_ai_does_not_publish_and_retry_succeeds(pipeline, monkeypatch):
    monkeypatch.setattr(difficulty, 'ask_ollama', lambda *args: {'scores': {}, 'reasons': {}})
    pipeline.post('/api/dictionary/collection', json={'limit': 2})
    job = collection.latest_job()
    assert job['status'] == 'partial' and job['failed'] == 2 and job['published'] == 0
    monkeypatch.setattr(difficulty, 'ask_ollama', lambda *args: PAYLOAD)
    pipeline.post('/api/dictionary/collection', json={'limit': 2})
    assert collection.latest_job()['published'] == 2


def test_unknown_frequency_holds_automatic_level(pipeline, monkeypatch):
    monkeypatch.setattr(difficulty, 'calculate_frequency', lambda *args: (0, None))
    pipeline.post('/api/dictionary/collection', json={'limit': 2})
    job = collection.latest_job()
    assert job['frequency_review'] == 2 and job['published'] == 0
    with connect() as db:
        assert db.execute("SELECT COUNT(*) FROM dictionary_senses WHERE source='wordnet' AND level IS NOT NULL").fetchone()[0] == 0


def test_jobs_are_exclusive_and_recover_after_restart(pipeline):
    job_id = collection.create_job(2)
    assert pipeline.post('/api/dictionary/collection', json={'limit': 2}).status_code == 409
    collection.recover_jobs()
    assert collection.latest_job()['status'] == 'interrupted'
    collection.run_job(job_id)
    assert collection.latest_job()['status'] == 'interrupted'
    assert pipeline.post('/api/dictionary/collection', json={'limit': 2}).status_code == 202


def test_model_failure_is_recorded_before_collecting(pipeline, monkeypatch):
    def fail(*args):
        raise ValueError('model not installed')
    monkeypatch.setattr(collection, 'ensure_model', fail)
    pipeline.post('/api/dictionary/collection', json={'limit': 2})
    job = collection.latest_job()
    assert job['status'] == 'failed' and job['error'] == 'model not installed'
    assert job['collected'] == 0


@pytest.mark.parametrize('limit', [0, 501, True, 1.5])
def test_collection_limit_is_validated(client, limit):
    assert client.post('/api/dictionary/collection', json={'limit': limit}).status_code == 422


def test_missing_model_configuration(client, monkeypatch):
    monkeypatch.setattr(config, 'OLLAMA_MODEL', '')
    assert client.post('/api/dictionary/collection', json={'limit': 2}).status_code == 400
    assert collection.latest_job() is None


def test_discovery_balances_frequency_and_excludes_finished_words(client, monkeypatch):
    import nltk.corpus
    monkeypatch.setattr(nltk.corpus, 'wordnet', SimpleNamespace(
        get_version=lambda: '3.0', all_lemma_names=lambda: ['apple', 'journey', 'ephemeral', 'london', 'ice_cream', 'nozipf'],
        lemmas=lambda word: [SimpleNamespace(name=lambda: 'London' if word == 'london' else word)]))
    frequencies = {'apple': 5.2, 'journey': 4.1, 'ephemeral': 2.5, 'london': 5.5, 'nozipf': 0}
    monkeypatch.setattr(collection, 'calculate_frequency', lambda word: (frequencies[word], 0))
    rubric = difficulty.load_rubric()[1]
    assert collection.discover_words(3, 'test', rubric) == ['apple', 'journey', 'ephemeral']
    with connect() as db:
        db.execute("""INSERT INTO dictionary_senses (word,pos,definition,sense_key,source,source_version)
          VALUES ('apple','n','fruit','apple:test','wordnet','3.0')""")
    assert collection.discover_words(2, 'test', rubric) == ['apple', 'journey']
    with connect() as db:
        db.execute('''INSERT INTO evaluations (word,pos,model,rubric_version,source_version,evaluated_at,status,review_status,metadata_json)
          VALUES ('apple','n','test',?,'3.0','now','complete','rejected','{}')''', (rubric,))
    assert collection.discover_words(2, 'test', rubric) == ['journey', 'ephemeral']
