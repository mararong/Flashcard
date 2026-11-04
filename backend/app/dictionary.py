import nltk
from .config import ROOT
from .db import connect
import os

nltk.data.path.insert(0, os.getenv('NLTK_DATA', str(ROOT / 'data/nltk')))


def wordnet_available():
    try:
        from nltk.corpus import wordnet
        wordnet.ensure_loaded()
        return True
    except LookupError:
        return False


def wordnet_entries(word):
    from nltk.corpus import wordnet as wn
    token=word.lower().replace(' ', '_')
    from .catalog_filter import word_reason,sense_reason
    entries=[]
    for syn in wn.synsets(token,lang='eng'):
        lemma=(wn.morphy(token,syn.pos()) or token).replace('_',' ')
        if word_reason(lemma) or sense_reason(lemma,syn):continue
        entries.append((lemma,syn.pos(),syn.definition(),f'{lemma}:{syn.name()}',wn.get_version()))
    return entries


def collect_word(word):
    entries=wordnet_entries(word)
    with connect() as db:
        for entry in entries:
            db.execute('''INSERT INTO dictionary_senses
              (word,pos,definition,sense_key,source,source_version)
              VALUES (?,?,?,?,'wordnet',?) ON CONFLICT(source,sense_key) DO UPDATE SET
              definition=excluded.definition,
              level=CASE WHEN source_version!=excluded.source_version THEN NULL ELSE level END,
              classification_kind=CASE WHEN source_version!=excluded.source_version THEN 'unclassified' ELSE classification_kind END,
              review_status=CASE WHEN source_version!=excluded.source_version THEN 'pending' ELSE review_status END,
              source_version=excluded.source_version''',
              entry)
    return len(entries)


def lookup(word):
    with connect() as db:
        rows = db.execute('SELECT * FROM dictionary_senses WHERE word=? COLLATE NOCASE ORDER BY source,id', (word,)).fetchall()
    if not rows and wordnet_available():
        keys=[entry[3] for entry in wordnet_entries(word)]
        collect_word(word)
        with connect() as db:
            rows = db.execute('SELECT * FROM dictionary_senses WHERE source=\'wordnet\' AND sense_key IN ('+
                              ','.join('?' for _ in keys)+')',keys).fetchall() if keys else []
    return [dict(row) for row in rows]
