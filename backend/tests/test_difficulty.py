import json
import pytest
import httpx
from app import config
from app.db import connect
from app.difficulty import frequency_score,level_for,validate_ai,evaluate_group,review_evaluation,ensure_model
from app.dictionary import collect_word,wordnet_available,lookup
from .conftest import add

PAYLOAD={'scores':{'abstractness':1,'complexity':1,'morphology':0,'context':1},
         'reasons':{'abstractness':'partly abstract','complexity':'a few meanings','morphology':'regular','context':'general texts'}}


@pytest.mark.parametrize('score,expected',[(0,1),(3,1),(4,2),(6,2),(7,3),(10,3)])
def test_level_boundaries(score,expected):assert level_for(score)==expected


@pytest.mark.parametrize('zipf,expected',[(5,0),(4.9,1),(4,1),(3.9,2),(3,2),(2.9,3),(0.1,3),(0,None)])
def test_frequency_boundaries(zipf,expected):assert frequency_score(zipf)==expected


@pytest.mark.parametrize('key,value',[('abstractness',3),('complexity',-1),('morphology',2),('context',2.0),('context',True)])
def test_invalid_ai_scores(key,value):
    payload=json.loads(json.dumps(PAYLOAD));payload['scores'][key]=value
    with pytest.raises(ValueError):validate_ai(payload)


def fake_ollama(payload):
    def handler(request):
        if request.url.path=='/api/tags':return httpx.Response(200,json={'models':[{'name':'test:latest'}]})
        return httpx.Response(200,json={'response':json.dumps(payload)})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_evaluation_cache_review_metadata_and_invalid_not_saved(client,monkeypatch):
    with fake_ollama(PAYLOAD) as ollama:
        assert evaluate_group('apple','n','demo-1',['사과'],'test',ollama)=='complete'
        assert evaluate_group('apple','n','demo-1',['사과'],'test',ollama)=='reused'
    with connect() as db:
        row=dict(db.execute('SELECT * FROM evaluations').fetchone())
        assert row['review_status']=='pending'
        assert row['total']==row['frequency_score']+3
        assert 'not part-of-speech specific' in json.loads(row['metadata_json'])['frequency_scope']
    assert len(client.get('/api/levels/1/cards?category=ai').json())==0
    assert review_evaluation(row['id'],True)==1
    assert len(client.get(f"/api/levels/{row['level']}/cards?category=ai").json())==1
    bad=json.loads(json.dumps(PAYLOAD));bad['scores']['context']=3
    with fake_ollama(bad) as ollama:assert evaluate_group('book','n','demo-1',['책'],'test',ollama)=='failed'
    with connect() as db:
        failed=dict(db.execute("SELECT * FROM evaluations WHERE word='book'").fetchone())
        assert failed['scores_json'] is None and failed['level'] is None and failed['error']
    with fake_ollama(PAYLOAD) as ollama:assert evaluate_group('book','n','demo-1',['책'],'test',ollama)=='complete'
    with connect() as db:assert db.execute("SELECT count(*) FROM evaluations WHERE word='book'").fetchone()[0]==1


def test_zero_frequency_holds_level_and_review(client,monkeypatch):
    monkeypatch.setattr('app.difficulty.calculate_frequency',lambda w,s:(0,None))
    with fake_ollama(PAYLOAD) as ollama:assert evaluate_group('rareword','n','3.0',['test'],'test',ollama)=='frequency_review'
    with connect() as db:
        row=db.execute('SELECT * FROM evaluations').fetchone()
        assert row['total'] is None and row['level'] is None
    with pytest.raises(ValueError):review_evaluation(row['id'],True)


def test_missing_model_never_downloads():
    with fake_ollama(PAYLOAD) as ollama:
        with pytest.raises(ValueError):ensure_model(ollama,'not-installed')


def test_wordnet_reimport_keeps_sense_and_personal_card_link(client,book):
    if not wordnet_available():pytest.skip('WordNet optional corpus not installed')
    assert collect_word('bank')>1
    with connect() as db:
        before=[dict(r) for r in db.execute("SELECT * FROM dictionary_senses WHERE word='bank' AND source='wordnet'")]
    card=add(client,book,'bank','은행',dictionary_id=before[0]['id'])
    collect_word('bank')
    with connect() as db:
        after=[dict(r) for r in db.execute("SELECT * FROM dictionary_senses WHERE word='bank' AND source='wordnet'")]
    assert before==after
    assert client.get(f'/api/notebooks/{book}').json()['cards'][0]['dictionary_id']==before[0]['id']


def test_wordnet_inflection_uses_canonical_lemma(client):
    if not wordnet_available():pytest.skip('WordNet optional corpus not installed')
    candidates=lookup('dogs')
    assert candidates and all(c['word']=='dog' for c in candidates)
    with connect() as db:
        before=db.execute("SELECT COUNT(*) FROM dictionary_senses WHERE word='dog'").fetchone()[0]
    collect_word('dog')
    with connect() as db:
        assert db.execute("SELECT COUNT(*) FROM dictionary_senses WHERE word='dog'").fetchone()[0]==before
