from app.db import init_db,seed_demo
if __name__=='__main__':
    init_db();seed_demo()
    print('시연용 수동 분류 30개 준비 완료. 기존 사용자 자료와 기록은 유지합니다.')
