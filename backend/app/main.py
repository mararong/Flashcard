import json
import random
import re
import uuid
from contextlib import asynccontextmanager
from typing import Literal
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from . import config
from .db import connect, init_db, seed_demo, now
from .dictionary import lookup, wordnet_available
from .collection import collection_status, create_job, recover_jobs, run_job


def normalize(value):
    return ' '.join(value.strip().split()).casefold()


@asynccontextmanager
async def lifespan(app):
    init_db()
    seed_demo()
    recover_jobs()
    wordnet_available()
    yield


app = FastAPI(title='단어의 숲 API', lifespan=lifespan)


class NameInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator('name')
    @classmethod
    def clean(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('이름을 입력해 주세요.')
        return value


class CardInput(BaseModel):
    word: str = Field(min_length=1, max_length=150)
    definition: str = Field(min_length=1, max_length=3000)
    pos: str = Field(default='', max_length=40)
    notes: str = Field(default='', max_length=3000)
    accepted_answers: list[str] = Field(default_factory=list, max_length=30)
    dictionary_id: int | None = None

    @field_validator('word', 'definition')
    @classmethod
    def clean(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('단어와 뜻을 입력해 주세요.')
        return value

    @field_validator('accepted_answers')
    @classmethod
    def clean_answers(cls, values):
        if any(len(v) > 150 for v in values):
            raise ValueError('허용 정답이 너무 깁니다.')
        return sorted(set(normalize(v) for v in values if normalize(v)))


class BatchInput(BaseModel):
    cards: list[CardInput] = Field(min_length=1, max_length=500)


class LookupInput(BaseModel):
    words: list[str] = Field(min_length=1, max_length=100)


class SavedInput(BaseModel):
    important: bool
    forgotten: bool


class Source(BaseModel):
    kind: Literal['notebook', 'level', 'saved', 'wrong']
    notebook_id: int | None = None
    level: int | None = Field(default=None, ge=1, le=3)
    category: Literal['all', 'demo', 'ai'] = 'all'
    saved_filter: Literal['all', 'important', 'forgotten'] = 'all'
    exam_id: str | None = None
    query: str = Field(default='', max_length=200)


class SessionInput(BaseModel):
    source: Source
    count: Literal['10', '20', 'all'] = '10'


class StudyProgress(BaseModel):
    position: int = Field(ge=0)
    flipped: bool


class ExamAnswers(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict)
    position: int = Field(default=0, ge=0)


def require(db, table, item_id):
    # Table names here are fixed by callers, never supplied by clients.
    row = db.execute(f'SELECT * FROM {table} WHERE id=?', (item_id,)).fetchone()
    if not row:
        raise HTTPException(404, '항목을 찾을 수 없습니다. 삭제되었을 수 있습니다.')
    return row


def card_dict(row):
    value = dict(row)
    value['accepted_answers'] = json.loads(value['accepted_answers'])
    value['important'] = bool(value.get('important', 0))
    value['forgotten'] = bool(value.get('forgotten', 0))
    return value


CARD_SELECT = '''SELECT c.*, COALESCE(s.important,0) important, COALESCE(s.forgotten,0) forgotten,
  d.level,d.classification_kind,d.review_status,d.source dictionary_source
  FROM cards c LEFT JOIN saved_cards s ON s.card_id=c.id
  LEFT JOIN dictionary_senses d ON d.id=c.dictionary_id'''


def cards_query(db, tail='', args=()):
    return [card_dict(r) for r in db.execute(CARD_SELECT + ' ' + tail, args).fetchall()]


@app.get('/api/health')
def health():
    with connect() as db:
        db.execute('SELECT 1').fetchone()
    return {'status':'ok', 'wordnet_available':wordnet_available(),
            'ai_configured':bool(config.OLLAMA_MODEL), 'ai_model':config.OLLAMA_MODEL or None}


@app.get('/api/dashboard')
def dashboard():
    with connect() as db:
        return {'notebooks':db.execute('SELECT COUNT(*) FROM notebooks').fetchone()[0],
                'personal_cards':db.execute("SELECT COUNT(DISTINCT card_id) FROM notebook_cards").fetchone()[0],
                'saved':db.execute('SELECT COUNT(*) FROM saved_cards').fetchone()[0],
                'completed_exams':db.execute('SELECT COUNT(*) FROM exams WHERE result_json IS NOT NULL').fetchone()[0]}


@app.get('/api/dictionary/collection')
def get_collection():
    return collection_status()


class CollectionInput(BaseModel):
    limit: int = Field(default=10, ge=1, le=500, strict=True)


@app.post('/api/dictionary/collection', status_code=202)
def start_collection(body: CollectionInput, background_tasks: BackgroundTasks):
    try:
        job_id = create_job(body.limit)
    except ValueError as exc:
        raise HTTPException(409 if '이미' in str(exc) else 400, str(exc)) from exc
    background_tasks.add_task(run_job, job_id)
    return {'id': job_id, 'status': 'queued'}


@app.get('/api/notebooks')
def notebooks():
    with connect() as db:
        return [dict(r) for r in db.execute('''SELECT n.*,COUNT(nc.card_id) card_count FROM notebooks n
          LEFT JOIN notebook_cards nc ON nc.notebook_id=n.id GROUP BY n.id ORDER BY n.id DESC''')]


@app.post('/api/notebooks', status_code=201)
def create_notebook(body: NameInput):
    with connect() as db:
        item_id = db.execute('INSERT INTO notebooks(name,created_at) VALUES (?,?)',(body.name,now())).lastrowid
        return dict(require(db,'notebooks',item_id))


@app.patch('/api/notebooks/{item_id}')
def rename_notebook(item_id: int, body: NameInput):
    with connect() as db:
        require(db,'notebooks',item_id)
        db.execute('UPDATE notebooks SET name=? WHERE id=?',(body.name,item_id))
        return dict(require(db,'notebooks',item_id))


@app.delete('/api/notebooks/{item_id}')
def delete_notebook(item_id: int):
    with connect() as db:
        require(db,'notebooks',item_id)
        db.execute('DELETE FROM notebooks WHERE id=?',(item_id,))
    return {'deleted':True}


@app.get('/api/notebooks/{item_id}')
def notebook_detail(item_id: int, q: str = Query(default='', max_length=200)):
    with connect() as db:
        book = dict(require(db,'notebooks',item_id))
        # Searching in Python keeps %, _ and commas literal.
        cards = cards_query(db,'JOIN notebook_cards nc ON nc.card_id=c.id WHERE nc.notebook_id=? ORDER BY c.id DESC',(item_id,))
        book['card_count'] = len(cards)
        book['cards'] = [c for c in cards if normalize(q) in normalize(c['word'] + ' ' + c['definition'])]
        return book


def duplicate(db, book_id, body, exclude=None):
    rows = db.execute('''SELECT c.* FROM cards c JOIN notebook_cards nc ON nc.card_id=c.id
      WHERE nc.notebook_id=?''',(book_id,)).fetchall()
    return any(r['id'] != exclude and normalize(r['word']) == normalize(body.word)
               and normalize(r['definition']) == normalize(body.definition)
               and normalize(r['pos']) == normalize(body.pos) for r in rows)


@app.post('/api/notebooks/{item_id}/cards', status_code=201)
def add_cards(item_id: int, body: BatchInput):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        require(db,'notebooks',item_id)
        added, skipped = [], 0
        for card in body.cards:
            if duplicate(db,item_id,card):
                skipped += 1
                continue
            if card.dictionary_id is not None:
                require(db,'dictionary_senses',card.dictionary_id)
            card_id = db.execute('''INSERT INTO cards(word,definition,pos,notes,accepted_answers,dictionary_id,created_at)
              VALUES (?,?,?,?,?,?,?)''', (card.word,card.definition,card.pos.strip(),card.notes.strip(),
              json.dumps(card.accepted_answers),card.dictionary_id,now())).lastrowid
            db.execute('INSERT INTO notebook_cards VALUES (?,?)',(item_id,card_id))
            added.append(card_id)
        return {'added':len(added),'skipped':skipped,'ids':added}


@app.patch('/api/cards/{item_id}')
def edit_card(item_id: int, body: CardInput):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        card = require(db,'cards',item_id)
        if card['kind'] != 'personal':
            raise HTTPException(403,'공용 사전은 개인 카드 편집으로 수정할 수 없습니다.')
        for link in db.execute('SELECT notebook_id FROM notebook_cards WHERE card_id=?',(item_id,)):
            if duplicate(db,link['notebook_id'],body,item_id):
                raise HTTPException(409,'같은 단어·뜻·품사의 카드가 이미 있습니다.')
        db.execute('''UPDATE cards SET word=?,definition=?,pos=?,notes=?,accepted_answers=? WHERE id=?''',
          (body.word,body.definition,body.pos.strip(),body.notes.strip(),json.dumps(body.accepted_answers),item_id))
        return cards_query(db,'WHERE c.id=?',(item_id,))[0]


@app.delete('/api/cards/{item_id}')
def delete_card(item_id: int):
    with connect() as db:
        card = require(db,'cards',item_id)
        if card['kind'] != 'personal':
            raise HTTPException(403,'공용 카드는 삭제할 수 없습니다. 저장 해제를 사용해 주세요.')
        db.execute('DELETE FROM cards WHERE id=?',(item_id,))
    return {'deleted':True}


@app.post('/api/dictionary/lookup')
def dictionary_lookup(body: LookupInput):
    words = list(dict.fromkeys(normalize(w) for w in body.words if normalize(w)))
    if any(len(w) > 150 for w in words):
        raise HTTPException(422,'단어는 150자 이내로 입력해 주세요.')
    return {'wordnet_available':wordnet_available(), 'results':[{'word':w,'candidates':lookup(w)} for w in words]}


@app.get('/api/levels')
def levels():
    with connect() as db:
        result=[]
        for level in [1,2,3]:
            all_cards = source_cards(db, Source(kind='level',level=level))
            result.append({'level':level,'demo':sum(c['classification_kind']=='manual_demo' for c in all_cards),
                           'ai':sum(c['classification_kind'] in ('ai','ai_auto') for c in all_cards),'total':len(all_cards)})
        return result


@app.get('/api/levels/{level}/cards')
def level_cards(level: int, category: Literal['all','demo','ai']='all'):
    if level not in [1,2,3]:
        raise HTTPException(422,'레벨은 1, 2, 3 중 하나를 선택해 주세요.')
    with connect() as db:
        return source_cards(db,Source(kind='level',level=level,category=category))


@app.put('/api/cards/{item_id}/saved')
def save_card(item_id: int, body: SavedInput):
    with connect() as db:
        require(db,'cards',item_id)
        if not body.important and not body.forgotten:
            db.execute('DELETE FROM saved_cards WHERE card_id=?',(item_id,))
        else:
            db.execute('''INSERT INTO saved_cards VALUES (?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET
              important=excluded.important,forgotten=excluded.forgotten,updated_at=excluded.updated_at''',
              (item_id,int(body.important),int(body.forgotten),now()))
        return {'card_id':item_id,**body.model_dump()}


@app.get('/api/saved')
def saved_cards(filter: Literal['all','important','forgotten']='all',q: str=Query(default='',max_length=200)):
    with connect() as db:
        cards = source_cards(db,Source(kind='saved',saved_filter=filter))
        return [c for c in cards if normalize(q) in normalize(c['word']+' '+c['definition'])]


def source_cards(db, source):
    if source.kind == 'notebook':
        if source.notebook_id is None:
            raise HTTPException(422,'단어장을 선택해 주세요.')
        require(db,'notebooks',source.notebook_id)
        return cards_query(db,'JOIN notebook_cards nc ON nc.card_id=c.id WHERE nc.notebook_id=?',(source.notebook_id,))
    if source.kind == 'saved':
        clause = 's.card_id IS NOT NULL'
        if source.saved_filter != 'all':
            clause += ' AND s.' + source.saved_filter + '=1'
        cards = cards_query(db,'WHERE '+clause)
        return [c for c in cards if normalize(source.query) in normalize(c['word']+' '+c['definition'])]
    if source.kind == 'level':
        if source.level is None:
            raise HTTPException(422,'레벨을 선택해 주세요.')
        clause = "WHERE c.kind='public' AND d.level=? AND (d.review_status='demo' OR (d.classification_kind='ai' AND d.review_status='approved') OR (d.classification_kind='ai_auto' AND d.review_status='automatic'))"
        if source.category == 'demo':
            clause += " AND d.classification_kind='manual_demo'"
        if source.category == 'ai':
            clause += " AND d.classification_kind IN ('ai','ai_auto') AND d.review_status IN ('approved','automatic')"
        return cards_query(db,clause,(source.level,))
    if not source.exam_id:
        raise HTTPException(422,'완료된 시험을 선택해 주세요.')
    exam = require(db,'exams',source.exam_id)
    if not exam['result_json']:
        raise HTTPException(409,'시험을 제출한 뒤 오답을 학습할 수 있습니다.')
    ids = [r['card_id'] for r in json.loads(exam['result_json'])['items'] if not r['correct']]
    if not ids:
        return []
    return cards_query(db,'WHERE c.id IN ('+','.join('?' for _ in ids)+')',tuple(ids))


def shuffled(cards, count):
    random.SystemRandom().shuffle(cards)
    return cards if count == 'all' else cards[:int(count)]


def study_response(db, row):
    cards = json.loads(row['cards_json'])
    if cards:
        # Reflect persisted save flags; immutable session snapshots preserve order/content.
        flags = {r['card_id']:r for r in db.execute('SELECT * FROM saved_cards')}
        existing = {r['id'] for r in db.execute('SELECT id FROM cards')}
        for c in cards:
            f = flags.get(c['id'])
            c.update(important=bool(f and f['important']),forgotten=bool(f and f['forgotten']),deleted=c['id'] not in existing)
    return {'id':row['id'],'source':json.loads(row['source_json']),'cards':cards,
            'position':row['position'],'flipped':bool(row['flipped']),'requested':row['requested']}


@app.post('/api/study',status_code=201)
def create_study(body: SessionInput):
    with connect() as db:
        cards=shuffled(source_cards(db,body.source),body.count)
        if not cards:
            raise HTTPException(400,'학습할 카드가 없습니다. 단어를 등록하거나 다른 출처를 선택해 주세요.')
        session_id = str(uuid.uuid4())
        db.execute('INSERT INTO study_sessions(id,source_json,cards_json,requested,created_at) VALUES (?,?,?,?,?)',
                   (session_id,body.source.model_dump_json(),json.dumps(cards,ensure_ascii=False),body.count,now()))
        return study_response(db,require(db,'study_sessions',session_id))


@app.get('/api/study/{session_id}')
def get_study(session_id: str):
    with connect() as db:
        return study_response(db,require(db,'study_sessions',session_id))


@app.patch('/api/study/{session_id}')
def update_study(session_id: str, body: StudyProgress):
    with connect() as db:
        session = require(db,'study_sessions',session_id)
        if body.position >= len(json.loads(session['cards_json'])):
            raise HTTPException(422,'카드 위치가 범위를 벗어났습니다.')
        db.execute('UPDATE study_sessions SET position=?,flipped=? WHERE id=?',(body.position,int(body.flipped),session_id))
        return study_response(db,require(db,'study_sessions',session_id))


def exam_response(row):
    questions = json.loads(row['questions_json'])
    result = json.loads(row['result_json']) if row['result_json'] else None
    return {'id':row['id'],'source':json.loads(row['source_json']),
            'questions':[{'id':str(i),'definition':q['definition'],'pos':q['pos'],
                          'classification_kind':q.get('classification_kind')} for i,q in enumerate(questions)],
            'answers':json.loads(row['answers_json']), 'position':row['position'],
            'requested':row['requested'], 'result':result}


@app.post('/api/exams',status_code=201)
def create_exam(body: SessionInput):
    if body.source.kind == 'saved':
        raise HTTPException(422,'시험은 개인 단어장 또는 레벨별 공용 단어를 선택해 주세요.')
    with connect() as db:
        cards=shuffled(source_cards(db,body.source),body.count)
        if not cards:
            raise HTTPException(400,'출제할 카드가 없습니다. 단어를 등록하거나 다른 출처를 선택해 주세요.')
        exam_id = str(uuid.uuid4())
        db.execute('INSERT INTO exams(id,source_json,questions_json,requested,parent_id,created_at) VALUES (?,?,?,?,?,?)',
                   (exam_id,body.source.model_dump_json(),json.dumps(cards,ensure_ascii=False),body.count,body.source.exam_id,now()))
        return exam_response(require(db,'exams',exam_id))


@app.get('/api/exams/{exam_id}')
def get_exam(exam_id: str):
    with connect() as db:
        return exam_response(require(db,'exams',exam_id))


def validate_answers(answers, questions):
    valid = {str(i) for i in range(len(questions))}
    if not set(answers).issubset(valid) or any(len(v)>300 for v in answers.values()):
        raise HTTPException(422,'답안의 문항 번호 또는 길이가 올바르지 않습니다.')


@app.put('/api/exams/{exam_id}/answers')
def save_answers(exam_id: str, body: ExamAnswers):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        exam = require(db,'exams',exam_id)
        if exam['result_json']:
            return exam_response(exam)
        questions = json.loads(exam['questions_json'])
        validate_answers(body.answers,questions)
        if body.position >= len(questions):
            raise HTTPException(422,'문항 위치가 올바르지 않습니다.')
        db.execute('UPDATE exams SET answers_json=?,position=? WHERE id=?',(json.dumps(body.answers),body.position,exam_id))
        return exam_response(require(db,'exams',exam_id))


@app.post('/api/exams/{exam_id}/submit')
def submit_exam(exam_id: str, body: ExamAnswers):
    with connect() as db:
        # Serializes concurrent submissions. The first committed result is immutable.
        db.execute('BEGIN IMMEDIATE')
        exam = require(db,'exams',exam_id)
        if exam['result_json']:
            return exam_response(exam)
        questions = json.loads(exam['questions_json'])
        validate_answers(body.answers,questions)
        items=[]
        for i,q in enumerate(questions):
            answer=body.answers.get(str(i),'')
            correct=normalize(answer) in {normalize(q['word']),*(normalize(a) for a in q['accepted_answers'])}
            items.append({'question_id':str(i),'card_id':q['id'],'definition':q['definition'],
                          'word':q['word'],'accepted_answers':q['accepted_answers'],'answer':answer,'correct':correct})
        correct_count=sum(i['correct'] for i in items)
        result={'total':len(items),'correct':correct_count,'wrong':len(items)-correct_count,
                'accuracy':round(correct_count/len(items)*100,1),'items':items}
        db.execute('UPDATE exams SET answers_json=?,result_json=?,submitted_at=? WHERE id=?',
                   (json.dumps(body.answers),json.dumps(result,ensure_ascii=False),now(),exam_id))
        return exam_response(require(db,'exams',exam_id))


@app.post('/api/exams/{exam_id}/save-wrong')
def save_wrong(exam_id: str):
    with connect() as db:
        exam = require(db,'exams',exam_id)
        if not exam['result_json']:
            raise HTTPException(409,'시험을 먼저 제출해 주세요.')
        saved=0
        for item in json.loads(exam['result_json'])['items']:
            if item['correct'] or not db.execute('SELECT id FROM cards WHERE id=?',(item['card_id'],)).fetchone():
                continue
            db.execute('''INSERT INTO saved_cards VALUES (?,0,1,?) ON CONFLICT(card_id)
              DO UPDATE SET forgotten=1,updated_at=excluded.updated_at''',(item['card_id'],now()))
            saved+=1
        return {'saved':saved}


@app.get('/api/exams')
def exam_history():
    with connect() as db:
        return [{'id':r['id'],'created_at':r['created_at'],'source':json.loads(r['source_json']),
                 'submitted':bool(r['result_json']),
                 'total':len(json.loads(r['questions_json'])),
                 'accuracy':json.loads(r['result_json'])['accuracy'] if r['result_json'] else None}
                for r in db.execute('SELECT * FROM exams ORDER BY created_at DESC LIMIT 20')]


dist = config.ROOT / 'frontend/dist'
if dist.exists():
    app.mount('/assets',StaticFiles(directory=dist/'assets'),name='assets')

    @app.get('/')
    def frontend_index():
        return FileResponse(dist/'index.html')
