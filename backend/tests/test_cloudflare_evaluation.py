import json
import httpx
import pytest
from app import config,local_evaluation as portable
from app.db import connect
from app.cloudflare_evaluation import (DEFAULT_MODEL,CloudflareScorer,BatchPaused,
    ProviderConfigurationError,cache_model,run_batch)

PAYLOAD={'scores':{'abstractness':1,'complexity':1,'morphology':0,'context':1},
         'reasons':{k:'Short rubric justification' for k in ('abstractness','complexity','morphology','context')}}
ACCOUNT='a'*32
TOKEN='fake-test-token-not-a-real-secret'


@pytest.fixture
def sample(client,monkeypatch,tmp_path):
    groups=dict(list(portable.catalog_groups().items())[:4])
    monkeypatch.setattr(portable,'catalog_groups',lambda:groups)
    monkeypatch.setenv('CF_FREE_PLAN_CONFIRMED','true')
    return groups,tmp_path/'checkpoint.json'


def provider(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def successful(request):
    assert request.url.host=='api.cloudflare.com'
    assert request.url.path.endswith('/ai/run/'+DEFAULT_MODEL)
    assert request.headers['Authorization']=='Bearer '+TOKEN
    body=json.loads(request.content)
    assert body['response_format']['json_schema']['properties']['scores']['properties']['morphology']['maximum']==1
    assert 'WordNet synset count' in body['messages'][1]['content']
    return httpx.Response(200,json={'success':True,'result':{'response':PAYLOAD}})


def test_bounded_run_resume_and_checkpoint(sample):
    groups,path=sample
    with provider(successful) as client:
        result=run_batch(DEFAULT_MODEL,10,1,path,account_id=ACCOUNT,token=TOKEN,client=client)
        assert result['evaluated']==1 and result['requests']==1 and result['paused']=='request_budget'
        assert len(json.loads(path.read_text())['evaluations'])==1
        result=run_batch(DEFAULT_MODEL,10,20,path,account_id=ACCOUNT,token=TOKEN,client=client)
        assert result['reused']==1 and result['evaluated']==len(groups)-1
    # Cache reuse needs no provider/client/token after explicit free-plan confirmation.
    assert run_batch(DEFAULT_MODEL,10,20,path)['requests']==0
    packet=json.loads(path.read_text())
    assert len(packet['evaluations'])==len(groups)
    assert TOKEN not in path.read_text() and ACCOUNT not in path.read_text()
    assert all(r['model']==cache_model(DEFAULT_MODEL) for r in packet['evaluations'])


@pytest.mark.parametrize('status',[200,400,403,429])
def test_quota_stops_without_marking_unfinished_failed(sample,status):
    groups,path=sample;calls=[]
    def handle(request):
        calls.append(request)
        if len(calls)==1:return successful(request)
        return httpx.Response(status,headers={'Retry-After':'3600'},json={'success':False,'errors':[{'message':'Daily neurons quota exceeded '+TOKEN}]})
    with provider(handle) as client:
        result=run_batch(DEFAULT_MODEL,10,20,path,account_id=ACCOUNT,token=TOKEN,client=client)
    assert result['paused']=='quota_or_rate_limit' and result['requests']==2
    assert result['failed']==0 and result['evaluated']==1
    assert TOKEN not in json.dumps(result) and TOKEN not in path.read_text()
    with connect() as db:assert db.execute('SELECT count(*) FROM evaluations').fetchone()[0]==1


def test_invalid_score_saved_as_failed_and_retried(sample):
    groups,path=sample
    bad=json.loads(json.dumps(PAYLOAD));bad['scores']['abstractness']=3
    with provider(lambda r:httpx.Response(200,json={'success':True,'result':{'response':bad}})) as client:
        result=run_batch(DEFAULT_MODEL,10,1,path,account_id=ACCOUNT,token=TOKEN,client=client)
    assert result['failed']==1
    with connect() as db:
        r=db.execute('SELECT * FROM evaluations').fetchone()
        assert r['level'] is None and r['scores_json'] is None
    with provider(successful) as client:
        result=run_batch(DEFAULT_MODEL,10,20,path,account_id=ACCOUNT,token=TOKEN,client=client)
    assert result['evaluated']==len(groups)
    with connect() as db:assert db.execute('SELECT count(*) FROM evaluations').fetchone()[0]==len(groups)


@pytest.mark.parametrize('status',[401,402,403])
def test_auth_error_stops_and_redacts(sample,status):
    groups,path=sample
    with provider(lambda r:httpx.Response(status,json={'success':False,'errors':[{'message':TOKEN}]})) as client:
        with pytest.raises(ProviderConfigurationError) as error:
            run_batch(DEFAULT_MODEL,10,20,path,account_id=ACCOUNT,token=TOKEN,client=client)
    assert TOKEN not in str(error.value)
    assert json.loads(path.read_text())['evaluations']==[]


def test_missing_configuration_and_paid_model_do_not_call_api(sample,monkeypatch):
    groups,path=sample
    def never(request):raise AssertionError('must not call Cloudflare')
    with provider(never) as client:
        with pytest.raises(ProviderConfigurationError):run_batch(DEFAULT_MODEL,10,20,path,account_id=ACCOUNT,token='',client=client)
        monkeypatch.delenv('CF_FREE_PLAN_CONFIRMED')
        with pytest.raises(ProviderConfigurationError):run_batch(DEFAULT_MODEL,10,20,path,account_id=ACCOUNT,token=TOKEN,client=client)
        monkeypatch.setenv('CF_FREE_PLAN_CONFIRMED','true')
        with pytest.raises(ValueError):run_batch('@cf/moonshotai/kimi-k2.6',10,20,path,account_id=ACCOUNT,token=TOKEN,client=client)


def test_interrupt_preserves_completed_results(sample):
    groups,path=sample
    def stop(*args,**kwargs):raise KeyboardInterrupt()
    with provider(successful) as client:
        with pytest.raises(KeyboardInterrupt):run_batch(DEFAULT_MODEL,10,20,path,account_id=ACCOUNT,token=TOKEN,client=client,progress=stop)
    assert len(json.loads(path.read_text())['evaluations'])==1


def test_string_json_and_network_pause():
    with provider(lambda r:httpx.Response(200,json={'success':True,'result':{'response':json.dumps(PAYLOAD)}})) as client:
        assert CloudflareScorer(ACCOUNT,TOKEN,DEFAULT_MODEL,client,1)('apple','n',['fruit'])==PAYLOAD
    def unavailable(request):raise httpx.ConnectError(TOKEN)
    with provider(unavailable) as client:
        with pytest.raises(BatchPaused) as error:CloudflareScorer(ACCOUNT,TOKEN,DEFAULT_MODEL,client,1)('apple','n',['fruit'])
    assert str(error.value)=='network_error' and TOKEN not in str(error.value)
