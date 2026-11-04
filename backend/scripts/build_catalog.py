"""Build a redistributable WordNet catalog and SQLite database, without AI."""
import json, re, sqlite3
from pathlib import Path
from nltk.corpus import wordnet as wn
from wordfreq import zipf_frequency
from app.dictionary import wordnet_available
from app.config import ROOT


def main():
    if not wordnet_available():
        raise SystemExit('Run python -m scripts.prepare_wordnet first')
    candidates=[]
    for word in wn.all_lemma_names():
        if re.fullmatch('[a-z]{2,24}',word):
            frequency=zipf_frequency(word,'en')
            if frequency>0: candidates.append((frequency,word))
    candidates.sort(key=lambda row:(-row[0],row[1]))
    rows=[]
    for frequency,word in candidates[:10000]:
        syn=wn.synsets(word)[0]
        rows.append(dict(word=word,pos=syn.pos(),definition=syn.definition(),sense_key=syn.name(),source='wordnet',source_version=wn.get_version(),zipf=frequency,level=1 if frequency>=5 else 2 if frequency>=4 else 3))
    dest=ROOT/'frontend/public/dictionary'
    dest.mkdir(parents=True,exist_ok=True)
    path=dest/'wordnet.sqlite3'
    if path.exists(): path.unlink()
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE words(word TEXT PRIMARY KEY,pos TEXT,definition TEXT,sense_key TEXT,source TEXT,source_version TEXT,zipf REAL,level INTEGER)')
        db.executemany('INSERT INTO words VALUES (:word,:pos,:definition,:sense_key,:source,:source_version,:zipf,:level)',rows)
    (ROOT/'frontend/src/wordnet.json').write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (dest/'LICENSE.txt').write_bytes((ROOT/'docs/WORDNET-LICENSE.txt').read_bytes())
    print(f'{len(rows)} unique words; levels '+str({level:sum(r['level']==level for r in rows) for level in (1,2,3)}))

if __name__=='__main__': main()
