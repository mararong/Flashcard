import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from . import config


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect():
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS dictionary_senses (
          id INTEGER PRIMARY KEY, word TEXT NOT NULL, pos TEXT NOT NULL,
          definition TEXT NOT NULL, sense_key TEXT NOT NULL, source TEXT NOT NULL,
          source_version TEXT NOT NULL, level INTEGER CHECK(level BETWEEN 1 AND 3),
          classification_kind TEXT NOT NULL DEFAULT 'unclassified',
          review_status TEXT NOT NULL DEFAULT 'pending', zipf REAL,
          frequency_score INTEGER, frequency_status TEXT, frequency_metadata TEXT,
          UNIQUE(source, sense_key)
        );
        CREATE TABLE IF NOT EXISTS evaluations (
          id INTEGER PRIMARY KEY, word TEXT NOT NULL, pos TEXT NOT NULL,
          model TEXT NOT NULL, rubric_version TEXT NOT NULL, source_version TEXT NOT NULL,
          evaluated_at TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
          zipf REAL, frequency_score INTEGER, scores_json TEXT, reasons_json TEXT,
          total INTEGER, level INTEGER, review_status TEXT NOT NULL DEFAULT 'pending',
          metadata_json TEXT NOT NULL, UNIQUE(word,pos,model,rubric_version,source_version)
        );
        CREATE TABLE IF NOT EXISTS cards (
          id INTEGER PRIMARY KEY, word TEXT NOT NULL, definition TEXT NOT NULL,
          pos TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
          accepted_answers TEXT NOT NULL DEFAULT '[]', kind TEXT NOT NULL DEFAULT 'personal',
          dictionary_id INTEGER REFERENCES dictionary_senses(id), created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS public_card_sense ON cards(dictionary_id) WHERE kind='public';
        CREATE TABLE IF NOT EXISTS notebooks (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notebook_cards (
          notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
          card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          PRIMARY KEY(notebook_id,card_id)
        );
        CREATE TABLE IF NOT EXISTS saved_cards (
          card_id INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
          important INTEGER NOT NULL DEFAULT 0, forgotten INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS study_sessions (
          id TEXT PRIMARY KEY, source_json TEXT NOT NULL, cards_json TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0, flipped INTEGER NOT NULL DEFAULT 0,
          requested TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS exams (
          id TEXT PRIMARY KEY, source_json TEXT NOT NULL, questions_json TEXT NOT NULL,
          answers_json TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0,
          requested TEXT NOT NULL, result_json TEXT, parent_id TEXT REFERENCES exams(id),
          created_at TEXT NOT NULL, submitted_at TEXT
        );
        ''')


DEMO = [
 (1,'apple','n','사과'), (1,'book','n','책'), (1,'water','n','물'),
 (1,'happy','a','행복한'), (1,'walk','v','걷다'), (1,'house','n','집'),
 (1,'friend','n','친구'), (1,'eat','v','먹다'), (1,'small','a','작은'), (1,'morning','n','아침'),
 (2,'journey','n','여행, 여정'), (2,'improve','v','개선하다'), (2,'curious','a','호기심이 많은'),
 (2,'opportunity','n','기회'), (2,'habit','n','습관'), (2,'compare','v','비교하다'),
 (2,'environment','n','환경'), (2,'patient','a','참을성 있는'), (2,'discover','v','발견하다'), (2,'achieve','v','달성하다'),
 (3,'ambiguity','n','모호함'), (3,'resilience','n','회복력'), (3,'ephemeral','a','덧없는, 일시적인'),
 (3,'paradigm','n','사고의 틀, 패러다임'), (3,'meticulous','a','꼼꼼한'), (3,'hypothesis','n','가설'),
 (3,'ubiquitous','a','어디에나 있는'), (3,'scrutinize','v','면밀히 조사하다'),
 (3,'juxtaposition','n','나란히 놓음, 병치'), (3,'conundrum','n','난해한 문제'),
]


def sync_public_card(db, sense):
    db.execute('''INSERT INTO cards(word,definition,pos,kind,dictionary_id,created_at)
      SELECT ?,?,?,'public',?,? WHERE NOT EXISTS
      (SELECT 1 FROM cards WHERE dictionary_id=? AND kind='public')''',
      (sense['word'],sense['definition'],sense['pos'],sense['id'],now(),sense['id']))
    db.execute("UPDATE cards SET word=?,definition=?,pos=? WHERE dictionary_id=? AND kind='public'",
               (sense['word'],sense['definition'],sense['pos'],sense['id']))


def seed_demo():
    with connect() as db:
        for level, word, pos, definition in DEMO:
            # Re-seeding never resets classifications, edits, notebooks, or saved records.
            db.execute('''INSERT INTO dictionary_senses
              (word,pos,definition,sense_key,source,source_version,level,classification_kind,review_status)
              VALUES (?,?,?,?,'demo','demo-1',?,'manual_demo','demo')
              ON CONFLICT(source,sense_key) DO NOTHING''', (word,pos,definition,f'{word}.{pos}',level))
        for sense in db.execute("SELECT * FROM dictionary_senses WHERE source='demo'").fetchall():
            sync_public_card(db, sense)
