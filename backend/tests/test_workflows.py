import json
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from app.main import app
from app.db import connect,seed_demo
from .conftest import add


def test_notebook_and_card_crud_db(client,book):
    card=add(client,book,'grow','자라다, 성장하다',pos='v')
    assert client.patch(f'/api/notebooks/{book}',json={'name':' 새로운 이름 '}).json()['name']=='새로운 이름'
    assert client.patch(f'/api/cards/{card}',json={'word':'grow','definition':'성장하다','pos':'v','notes':'grow every day','accepted_answers':['GROW UP']}).status_code==200
    assert client.get(f'/api/notebooks/{book}?q=성장').json()['cards'][0]['notes']=='grow every day'
    with connect() as db:
        assert db.execute('SELECT name FROM notebooks WHERE id=?',(book,)).fetchone()[0]=='새로운 이름'
        assert db.execute('SELECT definition FROM cards WHERE id=?',(card,)).fetchone()[0]=='성장하다'
    assert client.delete(f'/api/cards/{card}').status_code==200
    assert client.get(f'/api/notebooks/{book}').json()['card_count']==0
    assert client.delete(f'/api/notebooks/{book}').status_code==200
    assert client.get(f'/api/notebooks/{book}').status_code==404


def test_whitespace_duplicates_distinct_meaning_and_commas(client,book):
    response=client.post(f'/api/notebooks/{book}/cards',json={'cards':[
      {'word':' bank ','definition':'둑, 강둑'}, {'word':'BANK','definition':' 둑, 강둑 '},
      {'word':'bank','definition':'은행'}, {'word':'bank','definition':'은행','pos':'v'}]}).json()
    assert (response['added'],response['skipped'])==(3,1)
    cards=client.get(f'/api/notebooks/{book}').json()['cards']
    assert any(c['definition']=='둑, 강둑' for c in cards)
    assert client.get(f'/api/notebooks/{book}?q=%').json()['cards']==[]


def test_edit_duplicate_rejected(client,book):
    add(client,book,'bank','둑')
    other=add(client,book,'bank','은행')
    assert client.patch(f'/api/cards/{other}',json={'word':'bank','definition':'둑'}).status_code==409


def test_saved_idempotent_restart_and_delete_notebook(client,book):
    card=add(client,book)
    for _ in range(3):
        assert client.put(f'/api/cards/{card}/saved',json={'important':True,'forgotten':True}).status_code==200
    assert len(client.get('/api/saved').json())==1
    assert len(client.get('/api/saved?filter=important').json())==1
    with TestClient(app) as restarted:
        assert restarted.get('/api/saved').json()[0]['forgotten'] is True
        restarted.delete(f'/api/notebooks/{book}')
        assert restarted.get('/api/saved').json()[0]['id']==card
        restarted.delete(f'/api/cards/{card}')
        assert restarted.get('/api/saved').json()==[]


def test_unsave(client,book):
    card=add(client,book)
    client.put(f'/api/cards/{card}/saved',json={'important':True,'forgotten':False})
    client.put(f'/api/cards/{card}/saved',json={'important':False,'forgotten':False})
    assert client.get('/api/saved').json()==[]


def test_study_order_position_flip_restore(client,book):
    for i in range(7):add(client,book,f'word{i}',f'뜻 {i}')
    study=client.post('/api/study',json={'source':{'kind':'notebook','notebook_id':book},'count':'10'}).json()
    assert len(study['cards'])==7
    assert len({c['id'] for c in study['cards']})==7
    client.patch('/api/study/'+study['id'],json={'position':3,'flipped':True})
    with TestClient(app) as restarted:
        restored=restarted.get('/api/study/'+study['id']).json()
        assert restored['position']==3 and restored['flipped']
        assert [c['id'] for c in restored['cards']]==[c['id'] for c in study['cards']]
    assert client.patch('/api/study/'+study['id'],json={'position':7,'flipped':False}).status_code==422


def test_study_source_empty_count_and_saved_search(client,book):
    assert client.post('/api/study',json={'source':{'kind':'notebook','notebook_id':book}}).status_code==400
    a=add(client,book,'apple','사과');b=add(client,book,'book','책')
    for card in [a,b]:client.put(f'/api/cards/{card}/saved',json={'important':True,'forgotten':False})
    study=client.post('/api/study',json={'source':{'kind':'saved','query':'apple'},'count':'all'}).json()
    assert [c['id'] for c in study['cards']]==[a]
    assert client.post('/api/study',json={'source':{'kind':'level','level':1,'category':'ai'}}).status_code==400


def test_exam_no_answer_leak_normalization_and_alias(client,book):
    add(client,book,'Ice Cream','차가운 디저트',accepted_answers=['gelato'])
    add(client,book,'hello','안녕하세요')
    exam=client.post('/api/exams',json={'source':{'kind':'notebook','notebook_id':book},'count':'all'}).json()
    assert exam['result'] is None
    raw=json.dumps(exam)
    assert 'Ice Cream' not in raw and 'hello' not in raw and 'gelato' not in raw
    assert all(set(q)=={'id','definition','pos','classification_kind'} for q in exam['questions'])
    answers={q['id']:'  iCE   cREAM  ' if q['definition']=='차가운 디저트' else ' HELLO ' for q in exam['questions']}
    saved=client.put(f"/api/exams/{exam['id']}/answers",json={'answers':answers,'position':1}).json()
    assert saved['result'] is None and saved['position']==1 and saved['answers']==answers
    submitted=client.post(f"/api/exams/{exam['id']}/submit",json={'answers':answers}).json()
    assert submitted['result']['correct']==2 and submitted['result']['accuracy']==100
    second=client.post('/api/exams',json={'source':{'kind':'notebook','notebook_id':book},'count':'all'}).json()
    alias={q['id']:'gelato' if q['definition']=='차가운 디저트' else 'hi' for q in second['questions']}
    result=client.post(f"/api/exams/{second['id']}/submit",json={'answers':alias}).json()['result']
    assert result['correct']==1


def test_exam_level_restore_idempotence_wrong_workflows(client):
    exam=client.post('/api/exams',json={'source':{'kind':'level','level':2},'count':'20'}).json()
    assert len(exam['questions'])==10
    # Determine one correct answer only from database, never from pre-submit API.
    with connect() as db:
        questions=json.loads(db.execute('SELECT questions_json FROM exams WHERE id=?',(exam['id'],)).fetchone()[0])
    answers={'0':questions[0]['word'].upper(),'1':'incorrect'}
    client.put(f"/api/exams/{exam['id']}/answers",json={'answers':answers,'position':1})
    with TestClient(app) as restarted:
        loaded=restarted.get('/api/exams/'+exam['id']).json()
        assert loaded['answers']==answers and loaded['position']==1
        result=restarted.post(f"/api/exams/{exam['id']}/submit",json={'answers':answers}).json()
        duplicate=restarted.post(f"/api/exams/{exam['id']}/submit",json={'answers':{}}).json()
        assert result==duplicate and result['result']['correct']==1
        assert restarted.get('/api/dashboard').json()['completed_exams']==1
        wrong={'kind':'wrong','exam_id':exam['id']}
        retry=restarted.post('/api/exams',json={'source':wrong,'count':'all'}).json()
        assert len(retry['questions'])==9
        assert questions[0]['definition'] not in [q['definition'] for q in retry['questions']]
        study=restarted.post('/api/study',json={'source':wrong,'count':'all'}).json()
        assert len(study['cards'])==9
        for _ in range(2):assert restarted.post(f"/api/exams/{exam['id']}/save-wrong").json()['saved']==9
        assert len(restarted.get('/api/saved?filter=forgotten').json())==9


def test_concurrent_submit_only_one_result(client,book):
    add(client,book)
    exam=client.post('/api/exams',json={'source':{'kind':'notebook','notebook_id':book}}).json()
    def submit(value):return client.post(f"/api/exams/{exam['id']}/submit",json={'answers':{'0':value}}).json()
    with ThreadPoolExecutor(max_workers=2) as executor:results=list(executor.map(submit,['hello','wrong']))
    assert results[0]==results[1]
    assert client.get('/api/dashboard').json()['completed_exams']==1


def test_exam_snapshot_survives_edit_and_delete(client,book):
    card=add(client,book)
    exam=client.post('/api/exams',json={'source':{'kind':'notebook','notebook_id':book}}).json()
    client.patch(f'/api/cards/{card}',json={'word':'changed','definition':'수정'})
    client.delete(f'/api/cards/{card}')
    result=client.post(f"/api/exams/{exam['id']}/submit",json={'answers':{'0':'hello'}}).json()['result']
    assert result['correct']==1 and result['items'][0]['word']=='hello'


def test_reseed_preserves_all_user_data_and_ids(client,book):
    card=add(client,book)
    demo=client.get('/api/levels/1/cards').json()[0]['id']
    client.put(f'/api/cards/{demo}/saved',json={'important':True,'forgotten':False})
    seed_demo();seed_demo()
    assert client.get(f'/api/notebooks/{book}').json()['cards'][0]['id']==card
    assert client.get('/api/saved').json()[0]['id']==demo
    assert [l['total'] for l in client.get('/api/levels').json()]==[10,10,10]


def test_personal_edit_does_not_modify_dictionary(client,book):
    sense=client.post('/api/dictionary/lookup',json={'words':['apple']}).json()['results'][0]['candidates'][0]
    card=add(client,book,'apple','私の林檎',dictionary_id=sense['id'])
    client.patch(f'/api/cards/{card}',json={'word':'apple','definition':'나의 사과'})
    assert client.post('/api/dictionary/lookup',json={'words':['apple']}).json()['results'][0]['candidates'][0]['definition']=='사과'
    public=client.get('/api/levels/1/cards').json()[0]
    assert client.patch(f"/api/cards/{public['id']}",json={'word':'x','definition':'y'}).status_code==403


def test_wordnet_unavailable_manual_path_works(client,book,monkeypatch):
    import app.main as main
    import app.dictionary as dictionary
    monkeypatch.setattr(main,'wordnet_available',lambda:False)
    monkeypatch.setattr(dictionary,'wordnet_available',lambda:False)
    lookup=client.post('/api/dictionary/lookup',json={'words':['zzzzunlistedword']}).json()
    assert not lookup['wordnet_available'] and not lookup['results'][0]['candidates']
    card=add(client,book,'zzzzunlistedword','직접 입력')
    assert client.post('/api/study',json={'source':{'kind':'notebook','notebook_id':book}}).status_code==201
    assert client.post('/api/exams',json={'source':{'kind':'notebook','notebook_id':book}}).status_code==201


def test_invalid_inputs_and_unsubmitted_wrong_protected(client,book):
    assert client.post('/api/notebooks',json={'name':'   '}).status_code==422
    assert client.post(f'/api/notebooks/{book}/cards',json={'cards':[{'word':'a','definition':' '}] }).status_code==422
    assert client.post('/api/exams',json={'source':{'kind':'level','level':0}}).status_code==422
    exam=client.post('/api/exams',json={'source':{'kind':'level','level':1}}).json()
    assert client.post('/api/exams',json={'source':{'kind':'wrong','exam_id':exam['id']}}).status_code==409
    assert client.post(f"/api/exams/{exam['id']}/submit",json={'answers':{'999':'a'}}).status_code==422
