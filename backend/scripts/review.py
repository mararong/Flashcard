import argparse
import csv
from pathlib import Path
from app.db import connect,init_db
from app.difficulty import review_evaluation


def main():
    parser=argparse.ArgumentParser(description='AI 평가 검수: CSV 내보내기 또는 CLI 승인/거절')
    sub=parser.add_subparsers(dest='command',required=True)
    export=sub.add_parser('export');export.add_argument('path',type=Path)
    for name in ['approve','reject']:
        command=sub.add_parser(name);command.add_argument('ids',type=int,nargs='+')
    args=parser.parse_args()
    init_db()
    if args.command=='export':
        with connect() as db:
            rows=db.execute('SELECT * FROM evaluations ORDER BY id').fetchall()
        fields=['id','word','pos','model','rubric_version','source_version','status','error','zipf','frequency_score','scores_json','reasons_json','total','level','review_status','evaluated_at','metadata_json']
        with args.path.open('w',encoding='utf-8-sig',newline='') as file:
            writer=csv.DictWriter(file,fieldnames=fields);writer.writeheader()
            for row in rows:writer.writerow({f:row[f] for f in fields})
        print(f'{len(rows)}개 평가를 {args.path}에 저장했습니다. ID를 확인한 뒤 approve/reject 명령을 사용하세요.')
    else:
        for evaluation_id in args.ids:
            try:
                count=review_evaluation(evaluation_id,args.command=='approve')
                print(f'{evaluation_id}: {args.command} · {count}개 사전 의미 반영')
            except ValueError as exc:
                parser.exit(1,f'{evaluation_id}: {exc}\n')


if __name__=='__main__':
    main()
