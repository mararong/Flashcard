"""One command: discover WordNet words, collect definitions, classify and publish."""
import argparse
import json

from app.collection import create_job, latest_job, run_job, update_job
from app.db import init_db, now


def main():
    parser = argparse.ArgumentParser(description='WordNet 단어 자동 수집 → Ollama 난이도 분류 → 학습 카드 생성')
    parser.add_argument('--limit', type=int, default=10, help='자동 선정할 단어 수 (1~500, 기본 10)')
    args = parser.parse_args()
    init_db()
    try:
        job_id = create_job(args.limit)
    except ValueError as exc:
        parser.error(str(exc))
    try:
        run_job(job_id, lambda state: print(json.dumps(state, ensure_ascii=False), flush=True))
    except KeyboardInterrupt:
        update_job(job_id, status='interrupted', phase='종료됨', finished_at=now(),
                   error='사용자가 수집을 중단했습니다. 다시 실행하면 이어서 처리합니다.')
        parser.exit(130, '수집 중단. 완료된 항목은 저장되어 있습니다.\n')
    job = latest_job()
    print(json.dumps(job, ensure_ascii=False, indent=2))
    if job['status'] != 'complete':
        parser.exit(1)


if __name__ == '__main__':
    main()
