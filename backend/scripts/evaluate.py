import argparse
import httpx
from app import config
from app.db import init_db,connect
from app.difficulty import evaluate_group,ensure_model,load_rubric


def main():
    parser=argparse.ArgumentParser(description='설치된 Ollama 모델로 표제어+품사 배치 평가. 모델 다운로드 없음.')
    parser.add_argument('--limit',type=int,default=20)
    parser.add_argument('--retry-failed',action='store_true')
    parser.add_argument('--include-demo',action='store_true')
    args=parser.parse_args()
    if not config.OLLAMA_MODEL:
        parser.error('OLLAMA_MODEL을 .env 또는 환경변수에 지정해 주세요. 학습 앱은 AI 없이 실행할 수 있습니다.')
    if args.limit<1:
        parser.error('--limit은 1 이상이어야 합니다.')
    init_db()
    with connect() as db:
        rows=db.execute("SELECT * FROM dictionary_senses" + ('' if args.include_demo else " WHERE source='wordnet'")).fetchall()
        _,rubric=load_rubric()
        previous={(r['word'],r['pos'],r['source_version']):r['status'] for r in db.execute(
          'SELECT * FROM evaluations WHERE model=? AND rubric_version=?',(config.OLLAMA_MODEL,rubric))}
    groups={}
    for row in rows:
        key=(row['word'],row['pos'],row['source_version'])
        groups.setdefault(key,[]).append(row['definition'])
    candidates=[(k,v) for k,v in groups.items() if previous.get(k) not in ['complete','frequency_review'] and (not args.retry_failed or previous.get(k)=='failed')][:args.limit]
    if not candidates:
        print('처리할 항목이 없습니다. 완료된 동일 조건의 결과는 재사용됩니다.')
        return
    failed=0
    with httpx.Client(timeout=120,trust_env=False) as client:
        try:
            ensure_model(client,config.OLLAMA_MODEL)
        except (httpx.HTTPError,ValueError) as exc:
            parser.exit(1,f'Ollama 연결/모델 확인 실패: {exc}\n자동 모델 다운로드는 수행하지 않았습니다.\n')
        for (word,pos,source_version),definitions in candidates:
            status=evaluate_group(word,pos,source_version,definitions,config.OLLAMA_MODEL,client)
            failed+=status=='failed'
            print(f'{word}/{pos}: {status} · 정상 결과도 검수 전에는 공개하지 않습니다.')
    if failed:
        parser.exit(1,f'{failed}개 실패. 오류는 SQLite evaluations에 기록되었습니다. --retry-failed로 재시도하세요.\n')


if __name__=='__main__':
    main()
