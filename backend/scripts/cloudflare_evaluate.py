import argparse
import json
import signal
from pathlib import Path
from app.db import init_db
from app.cloudflare_evaluation import model_name,cache_model,run_batch
from app.local_evaluation import import_results,publish_results


def main():
    parser=argparse.ArgumentParser(description='Cloudflare 무료 플랜의 클라우드 전용 WordNet 배치 평가')
    sub=parser.add_subparsers(dest='command',required=True)
    run=sub.add_parser('run')
    run.add_argument('--limit',type=int,default=10)
    run.add_argument('--max-requests',type=int,default=20)
    run.add_argument('--checkpoint',type=Path,default=Path('data/cloudflare-results.json'))
    sub.add_parser('publish')
    args=parser.parse_args();init_db()
    def stop(signum,frame):raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,stop)
    try:
        model=model_name()
        if args.command=='publish':result=publish_results(cache_model(model))
        else:
            if args.checkpoint.exists():import_results(args.checkpoint)
            result=run_batch(model,args.limit,args.max_requests,args.checkpoint)
        print(json.dumps(result,ensure_ascii=False))
        if result.get('paused') not in (None,'request_budget','quota_or_rate_limit'):
            parser.exit(1,'일시 중단했습니다. 체크포인트를 보존한 뒤 다시 실행하세요.\n')
        if result.get('failed',0):parser.exit(1,'유효하지 않은 평가가 있습니다. 실패 내역을 확인한 뒤 재실행하세요.\n')
    except KeyboardInterrupt:parser.exit(130,'중단했습니다. 완료 결과는 체크포인트에 저장했습니다.\n')
    except Exception as exc:
        # Error types here deliberately use sanitized messages; never echo the API response or credentials.
        parser.exit(1,f'평가를 시작/계속할 수 없습니다: {exc}\n')


if __name__=='__main__':main()
