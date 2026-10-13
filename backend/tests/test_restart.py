import os
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
import httpx

ROOT=Path(__file__).resolve().parents[2]


@contextmanager
def server(db_path):
    with socket.socket() as socket_probe:
        socket_probe.bind(('127.0.0.1',0));port=socket_probe.getsockname()[1]
    with (db_path.parent/'server.log').open('a') as log:
        process=subprocess.Popen([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port',str(port)],
          cwd=ROOT,env={**os.environ,'PYTHONPATH':str(ROOT/'backend'),'FLASHCARD_DB':str(db_path)},stdout=log,stderr=log)
        try:
            with httpx.Client(base_url=f'http://127.0.0.1:{port}/api',trust_env=False,timeout=5) as client:
                deadline=time.monotonic()+20
                while time.monotonic()<deadline:
                    if process.poll() is not None:
                        raise AssertionError('서버 시작 실패: '+(db_path.parent/'server.log').read_text())
                    try:
                        if client.get('/health').status_code==200:break
                    except httpx.HTTPError:pass
                    time.sleep(.05)
                else:raise AssertionError('서버 시작 시간 초과')
                yield client
        finally:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()


def test_actual_process_restart_preserves_saved_study_and_exam(tmp_path):
    path=tmp_path/'restart.sqlite3'
    with server(path) as client:
        book=client.post('/notebooks',json={'name':'재시작 검증'}).json()['id']
        ids=client.post(f'/notebooks/{book}/cards',json={'cards':[{'word':'one','definition':'하나'},{'word':'two','definition':'둘'}]}).json()['ids']
        client.put(f'/cards/{ids[0]}/saved',json={'important':True,'forgotten':True}).raise_for_status()
        study=client.post('/study',json={'source':{'kind':'notebook','notebook_id':book},'count':'all'}).json()
        client.patch(f"/study/{study['id']}",json={'position':1,'flipped':True}).raise_for_status()
        exam=client.post('/exams',json={'source':{'kind':'notebook','notebook_id':book},'count':'all'}).json()
        client.put(f"/exams/{exam['id']}/answers",json={'answers':{'0':'one'},'position':1}).raise_for_status()
    with server(path) as client:
        saved=client.get('/saved').json()
        assert len(saved)==1 and saved[0]['important'] and saved[0]['forgotten']
        restored=client.get(f"/study/{study['id']}").json()
        assert restored['position']==1 and restored['flipped']
        assert [c['id'] for c in restored['cards']]==[c['id'] for c in study['cards']]
        restored_exam=client.get(f"/exams/{exam['id']}").json()
        assert restored_exam['answers']=={'0':'one'} and restored_exam['position']==1
        assert restored_exam['result'] is None
