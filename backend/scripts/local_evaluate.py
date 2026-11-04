import argparse
import json
from pathlib import Path
from app import config
from app.db import init_db
from app.local_evaluation import run_batch,export_results,import_results,publish_results


def main():
    parser=argparse.ArgumentParser(description='사용자 PC 전용 Ollama 평가·SQLite 저장·공용 결과 이동')
    commands=parser.add_subparsers(dest='command',required=True)
    run=commands.add_parser('run')
    scope=run.add_mutually_exclusive_group(required=True)
    scope.add_argument('--limit',type=int,help='빈도순 표제어 수. 여러 품사는 각각 평가합니다.')
    scope.add_argument('--all',action='store_true')
    run.add_argument('--timeout',type=float,default=180)
    export=commands.add_parser('export');export.add_argument('path',type=Path)
    imp=commands.add_parser('import');imp.add_argument('path',type=Path)
    commands.add_parser('publish')
    args=parser.parse_args();init_db()
    try:
        if args.command=='run':
            if args.limit is not None and args.limit<1:parser.error('--limit은 1 이상이어야 합니다.')
            if args.timeout<=0:parser.error('--timeout은 양수여야 합니다.')
            result=run_batch(config.OLLAMA_MODEL,args.limit,args.timeout)
        elif args.command=='export':result={'exported':export_results(args.path,config.OLLAMA_MODEL)}
        elif args.command=='import':result=import_results(args.path)
        else:result=publish_results(config.OLLAMA_MODEL)
        print(json.dumps(result,ensure_ascii=False))
        if result.get('failed',0):parser.exit(1,'실패한 항목은 기록했습니다. 같은 명령으로 미완료 항목을 이어서 처리하세요.\n')
    except KeyboardInterrupt:parser.exit(130,'\n중단했습니다. 완료 결과는 SQLite에 보존됩니다. 같은 명령으로 이어서 실행하세요.\n')
    except Exception as exc:parser.exit(1,f'처리 실패: {exc}\n')


if __name__=='__main__':main()
