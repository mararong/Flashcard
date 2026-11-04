"""Build filtered WordNet candidates; only reviewed five-factor AI results receive levels."""
import argparse,json,sqlite3,hashlib
from collections import Counter
from nltk.corpus import wordnet as wn
from wordfreq import zipf_frequency
from app.dictionary import wordnet_available
from app.config import ROOT,OLLAMA_MODEL
from app.db import init_db,connect
from app.difficulty import evaluate_group,load_rubric,validate_ai,frequency_score,level_for
from app.catalog_filter import word_reason,sense_reason,POLICY_VERSION


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--evaluate',action='store_true',help='Use configured existing Ollama model; no downloads')
    parser.add_argument('--limit',type=int,default=10000)
    parser.add_argument('--model',default=OLLAMA_MODEL,help='Exact model whose current rubric results are exported')
    args=parser.parse_args()
    if not wordnet_available():parser.error('Run scripts.prepare_wordnet first')
    if args.evaluate and not args.model:parser.error('Set OLLAMA_MODEL or --model; no substitute scoring is allowed')
    if args.evaluate:
        import httpx
        from app.difficulty import ensure_model
        with httpx.Client(timeout=10) as client:ensure_model(client,args.model)
    init_db();settings,rubric=load_rubric();rejected=Counter();candidates=[]
    for word in set(wn.all_lemma_names()):
        reason=word_reason(word)
        if reason:rejected[reason]+=1;continue
        zipf=zipf_frequency(word,'en')
        if zipf<=0:rejected['unknown_frequency']+=1;continue
        senses=[]
        for syn in {s.name():s for s in wn.synsets(word)}.values():
            reason=sense_reason(word,syn)
            if reason:rejected[reason]+=1
            else:senses.append(syn)
        if senses:candidates.append((zipf,word,senses))
    candidates.sort(key=lambda x:(-x[0],x[1]));rows=[]
    for zipf,word,senses in candidates[:args.limit]:
        groups={}
        for syn in senses:groups.setdefault(syn.pos(),[]).append(syn)
        for pos,group in groups.items():
            definitions=[s.definition() for s in group]
            # A definition-set hash invalidates evaluations when the collection policy/senses change.
            source_version=wn.get_version()+':'+POLICY_VERSION+':'+hashlib.sha256(json.dumps(definitions).encode()).hexdigest()[:12]
            if args.evaluate:evaluate_group(word,pos,source_version,definitions,args.model)
            with connect() as db:
                evaluation=db.execute('SELECT * FROM evaluations WHERE word=? AND pos=? AND model=? AND rubric_version=? AND source_version=? AND status=\'complete\' AND review_status=\'approved\'',(word,pos,args.model,rubric,source_version)).fetchone() if args.model else None
            level=total=None;scores=reasons=None;freq=frequency_score(zipf,settings)
            if evaluation:
                scores,reasons=validate_ai({'scores':json.loads(evaluation['scores_json']),'reasons':json.loads(evaluation['reasons_json'])})
                if evaluation['frequency_score']!=freq:raise ValueError('Cached frequency score mismatch')
                total=freq+sum(scores.values());level=level_for(total)
            for syn in group:
                rows.append(dict(word=word,pos=pos,definition=syn.definition(),sense_key=syn.name(),source='wordnet',source_version=source_version,zipf=zipf,frequency_score=freq,level=level,total=total,scores=scores,reasons=reasons,model=args.model or None,rubric_version=rubric,filter_version=POLICY_VERSION,status='approved' if level else 'pending_ai_review'))
    dest=ROOT/'frontend/public/dictionary';dest.mkdir(parents=True,exist_ok=True);path=dest/'wordnet.sqlite3'
    if path.exists():path.unlink()
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE words(word TEXT,pos TEXT,definition TEXT,sense_key TEXT,source TEXT,source_version TEXT,zipf REAL,frequency_score INTEGER,level INTEGER,total INTEGER,scores TEXT,reasons TEXT,model TEXT,rubric_version TEXT,filter_version TEXT,status TEXT,PRIMARY KEY(word,pos,sense_key))')
        db.executemany('INSERT INTO words VALUES (:word,:pos,:definition,:sense_key,:source,:source_version,:zipf,:frequency_score,:level,:total,:scores,:reasons,:model,:rubric_version,:filter_version,:status)',[{**r,'scores':json.dumps(r['scores']),'reasons':json.dumps(r['reasons'])} for r in rows])
    (ROOT/'frontend/src/wordnet.json').write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    report={'catalog_version':hashlib.sha256((ROOT/'frontend/src/wordnet.json').read_bytes()).hexdigest(),'policy':POLICY_VERSION,'words':len({r['word'] for r in rows}),'senses':len(rows),'approved':sum(r['level'] is not None for r in rows),'excluded':dict(rejected)}
    (dest/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
    (dest/'LICENSE.txt').write_bytes((ROOT/'docs/WORDNET-LICENSE.txt').read_bytes())

if __name__=='__main__':main()
