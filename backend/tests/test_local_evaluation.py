import json
import sqlite3
from pathlib import Path
import httpx
import pytest
from app import config
from app.db import connect
from app import local_evaluation as local
from app.difficulty import review_evaluation
from .conftest import add

SCORES={'scores':{'abstractness':1,'complexity':1,'morphology':0,'context':1},
        'reasons':{k:'테스트 근거' for k in ('abstractness','complexity','morphology','context')}}


@pytest.fixture
def sample(client,monkeypatch,tmp_path):
    complete=local.catalog_groups()
    groups=dict(list(complete.items())[:3])
    monkeypatch.setattr(local,'catalog_groups',lambda:groups)
    monkeypatch.setattr(config,'OLLAMA_URL','http://localhost:11434')
    return groups


def mock_client(calls,fail_word=None):
    def respond(request):
        if request.url.path=='/api/tags':return httpx.Response(200,json={'models':[{'name':'test:latest'},{'name':'another-model:latest'}]})
        assert request.url.host=='localhost'
        body=json.loads(request.content);prompt=json.loads(body['prompt'])
        calls.append(prompt['word'])
        payload=json.loads(json.dumps(SCORES))
        if prompt['word']==fail_word:payload['scores']['morphology']=9
        return httpx.Response(200,json={'response':json.dumps(payload)})
    return httpx.Client(transport=httpx.MockTransport(respond))


def test_pilot_all_resume_and_changed_model(sample):
    calls=[]
    first_word=next(iter(sample))[0]
    expected=sum(key[0]==first_word for key in sample)
    with mock_client(calls) as client:
        assert local.run_batch('test',1,client=client)['evaluated']==expected
        result=local.run_batch('test',client=client)
        assert result['reused']==expected and result['evaluated']==len(sample)-expected
        assert len(calls)==len(sample)
    # All completed: no real HTTP client is created and no server is needed.
    assert local.run_batch('test')['reused']==len(sample)
    with mock_client(calls) as client:
        assert local.run_batch('another-model',client=client)['evaluated']==len(sample)


def test_interrupt_commits_previous_group(sample):
    calls=[]
    def stop(*args,**kwargs):raise KeyboardInterrupt()
    with mock_client(calls) as client:
        with pytest.raises(KeyboardInterrupt):local.run_batch('test',client=client,progress=stop)
        result=local.run_batch('test',client=client)
    assert result['reused']==1 and len(calls)==len(sample)


def test_failed_group_only_retries(sample):
    calls=[];bad_word=next(iter(sample))[0]
    with mock_client(calls,bad_word) as client:result=local.run_batch('test',client=client)
    assert result['failed']>0
    with mock_client(calls) as client:retry=local.run_batch('test',client=client)
    assert retry['evaluated']==result['failed']
    assert retry['reused']==len(sample)-result['failed']
    with connect() as db:
        assert db.execute('SELECT count(*) FROM evaluations').fetchone()[0]==len(sample)


def test_transfer_validates_all_and_preserves_personal_data(sample,client,book,tmp_path):
    personal=add(client,book,'personal','나의 뜻')
    with mock_client([]) as ollama:local.run_batch('test',client=ollama)
    packet=tmp_path/'results.json'
    assert local.export_results(packet,'test')==len(sample)
    payload=json.loads(packet.read_text())
    assert 'personal' not in packet.read_text()
    assert local.import_results(packet)['skipped']==len(sample)
    # Simulate a fresh receiving evaluation DB without touching personal tables.
    with connect() as db:db.execute('DELETE FROM evaluations')
    damaged=json.loads(json.dumps(payload));damaged['evaluations'][-1]['total']=99
    packet.write_text(json.dumps(damaged))
    with pytest.raises(ValueError):local.import_results(packet)
    with connect() as db:assert db.execute('SELECT count(*) FROM evaluations').fetchone()[0]==0
    packet.write_text(json.dumps(payload))
    assert local.import_results(packet)['imported']==len(sample)
    assert local.import_results(packet)['skipped']==len(sample)
    assert client.get(f'/api/notebooks/{book}').json()['cards'][0]['id']==personal
    # Review states can travel later without rerunning AI or replacing result IDs.
    payload['evaluations'][0]['review_status']='approved';packet.write_text(json.dumps(payload))
    local.import_results(packet)
    with connect() as db:
        assert db.execute('SELECT review_status FROM evaluations ORDER BY id LIMIT 1').fetchone()[0]=='approved'


def test_publish_offline_only_approved(sample,monkeypatch,tmp_path):
    with mock_client([]) as ollama:local.run_batch('test',client=ollama)
    with connect() as db:approved_id=db.execute('SELECT id FROM evaluations ORDER BY id LIMIT 1').fetchone()[0]
    review_evaluation(approved_id,True)
    root=tmp_path/'project';dest=root/'frontend/public/dictionary';dest.mkdir(parents=True)
    (root/'frontend/src').mkdir()
    (dest/'report.json').write_text(json.dumps({'policy':'learner-content-v1'}))
    source=dest/'wordnet.sqlite3'
    with sqlite3.connect(local.CATALOG) as db:schema=db.execute("SELECT sql FROM sqlite_master WHERE name='words'").fetchone()[0]
    senses=[s for group in sample.values() for s in group['senses']]
    with sqlite3.connect(source) as db:
        db.execute(schema)
        columns=[row[1] for row in db.execute('PRAGMA table_info(words)')]
        db.executemany('INSERT INTO words VALUES ('+','.join('?' for _ in columns)+')',[tuple(s[c] for c in columns) for s in senses])
    monkeypatch.setattr(local,'CATALOG',source)
    monkeypatch.setattr(config,'ROOT',root)
    # load_rubric reads ROOT; preserve the real rubric in this temporary project.
    (root/'backend').mkdir();(root/'backend/difficulty.json').write_bytes((Path(__file__).parents[1]/'difficulty.json').read_bytes())
    result=local.publish_results('test')
    assert 0<result['approved_senses']<=len(senses)
    rows=json.loads((root/'frontend/src/wordnet.json').read_text())
    assert all(r['status']=='approved' for r in rows if r['level'] is not None)
    assert any(r['level'] is None for r in rows)


@pytest.mark.parametrize('url',['https://example.com:11434','http://192.168.1.5:11434','http://localhost:9999','http://localhost:11434/proxy'])
def test_nonlocal_or_nonstandard_endpoints_rejected(url):
    with pytest.raises(ValueError):local.validate_local_url(url)
