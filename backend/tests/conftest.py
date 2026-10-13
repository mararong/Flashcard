import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import config
from app.main import app


@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(config,'DB_PATH',tmp_path/'test.sqlite3')
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def book(client):
    return client.post('/api/notebooks',json={'name':'내 테스트 단어장'}).json()['id']


def add(client,book,word='hello',definition='안녕하세요',**extra):
    return client.post(f'/api/notebooks/{book}/cards',json={'cards':[{'word':word,'definition':definition,**extra}]}).json()['ids'][0]
