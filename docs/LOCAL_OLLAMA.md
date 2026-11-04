# 내 PC에서 Ollama 평가하기

Ollama는 **내 PC의 `http://localhost:11434`**에서 실행합니다. 클라우드에서 내 PC에 연결하지 않습니다. 클라우드에는 평가가 끝난 공용 결과 파일만 옮깁니다. 모델은 자동 다운로드하지 않으며 이미 설치된 모델 이름을 환경변수로 지정합니다.

## 1. 프로젝트와 Python 준비

Windows에 Python 3.12와 Git을 설치합니다. PowerShell에서:

```powershell
git clone https://github.com/mararong/Flashcard.git
cd Flashcard
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock
```

이미 내려받은 프로젝트는 해당 폴더에서 `git pull` 후 진행합니다. ZIP으로 내려받았다면 README.md가 있는 폴더에서 시작하세요. 평가에는 Node.js나 WordNet 추가 다운로드가 필요 없습니다. 저장소에 포함된 필터링된 사전 SQLite를 사용합니다.

## 2. 로컬 Ollama와 모델 설정

Ollama 앱을 실행하거나 별도 터미널에서 `ollama serve`를 실행합니다. 이미 앱이 실행 중이면 서버를 또 띄울 필요가 없습니다. 설치된 모델을 확인합니다.

```powershell
ollama list
$env:OLLAMA_URL = "http://localhost:11434"
$env:OLLAMA_MODEL = "ollama list에서 확인한 실제 모델명"
$env:PYTHONPATH = "$PWD\backend"
```

위 모델명 예시를 실제 설치된 이름으로 바꾸세요. 이 환경변수들은 **현재 PowerShell 창**에 적용됩니다. 새 창을 열면 다시 설정합니다. `.env.example`을 `.env`로 복사해 OLLAMA_MODEL을 지정해도 됩니다. 프로세스 환경변수가 `.env`보다 우선합니다. 서버 주소는 localhost·127.0.0.1·::1의 HTTP 11434 포트만 허용합니다.

## 3. 먼저 10개 표제어 시험 평가

```powershell
.\.venv\Scripts\python.exe -m scripts.local_evaluate run --limit 10
```

항상 같은 빈도순 첫 **10개 표제어**를 선택합니다. 평가 단위가 표제어+품사이므로 실제 AI 요청 수는 10보다 많을 수 있습니다. 정상 결과는 각각 완료 즉시 `data/flashcard.sqlite3`의 `evaluations` 테이블에 커밋합니다. 첫 응답은 모델 로딩 때문에 시간이 걸릴 수 있습니다.

분류는 빈도 0~3 + 추상성 0~2 + 주요 의미군 복잡도 0~2 + 형태 0~1 + 맥락 0~2입니다. AI JSON의 정수·범위·근거를 검증하고 서버가 합계와 L1(0~3)·L2(4~6)·L3(7~10)를 계산합니다. 모델·기준 버전·사전 정의 해시·평가 시각·오류도 보관합니다. 실패한 평가에 임시 레벨을 붙이지 않습니다.

CSV를 열어 시험 결과의 근거와 수준을 확인합니다.

```powershell
.\.venv\Scripts\python.exe -m scripts.review export data\pilot-review.csv
```

## 4. 전체 평가와 중단 후 재개

```powershell
.\.venv\Scripts\python.exe -m scripts.local_evaluate run --all
```

10개 시험 평가에서 끝난 같은 조건의 결과는 재사용하고, 나머지만 처리합니다. **중단은 Ctrl+C**, 재개는 **같은 명령**입니다. 완료된 표제어+품사는 건너뛰고 실패·미실행 항목만 처리합니다. 중단 순간 처리 중이던 한 항목은 다음 실행에서 다시 평가합니다. 재개 전에 모델명과 프로젝트의 사전·기준 버전을 그대로 유지하세요. 모델이나 사전/기준이 바뀌면 새 조건의 평가가 됩니다.

응답이 느린 PC는 제한 시간을 늘릴 수 있습니다.

```powershell
.\.venv\Scripts\python.exe -m scripts.local_evaluate run --all --timeout 600
```

오류는 DB에 기록되고 다른 단어로 계속 진행합니다. 실패가 남으면 명령은 종료 코드 1을 반환합니다. Ollama 연결/모델 목록 확인 실패 시에는 전체 단어를 반복 요청하지 않고 즉시 종료합니다. 동시에 여러 평가 프로세스를 실행하지 마세요.

## 5. 공용 평가 결과 내보내기

```powershell
.\.venv\Scripts\python.exe -m scripts.local_evaluate export data\public-evaluations.json
```

현재 모델·기준·사전 버전에 해당하는 공용 평가만 JSON으로 내보냅니다. 개인 단어장·카드·중요/잊음·학습/시험 기록·환경변수는 포함하지 않습니다. 부분 완료 상태에서도 내보낼 수 있습니다. 다른 PC에서 이어서 평가하려면 이 파일을 가져온 뒤 동일 모델·기준으로 `run --all`을 실행합니다.

전체 SQLite 파일을 옮기면 개인 기록도 포함되므로 **클라우드에는 위 JSON만 전달**하세요. 필터링된 사전 자체는 같은 버전의 프로젝트에 이미 포함되어 있습니다.

## 6. 클라우드에서 가져오기 — Ollama 불필요

같은 버전의 프로젝트를 열고 `public-evaluations.json`을 클라우드 작업 폴더에 업로드한 뒤 다음 명령을 실행합니다.

```bash
PYTHONPATH=backend .venv/bin/python -m scripts.local_evaluate import /path/to/public-evaluations.json
```

Windows의 다른 PC로 가져올 때는:

```powershell
$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m scripts.local_evaluate import C:\path\to\public-evaluations.json
```

가져오기는 Ollama를 호출하지 않습니다. 모든 레코드의 사전·필터·기준 버전, 정수 점수와 범위, 빈도, 합계·레벨을 검증한 뒤 DB에 반영합니다. 같은 파일을 다시 넣어도 중복 결과가 생기지 않습니다. 완료 결과와 점수가 충돌하면 오류로 종료하고 해당 가져오기 작업의 평가 변경을 취소합니다. 기존 개인 자료는 유지합니다. 검수 상태도 이동하며, 기존의 명시적 승인·거절을 미검수 결과로 덮어쓰지 않습니다.

## 7. 검수 후 학습용으로 공개

평가 완료와 검수 완료는 구분합니다. CSV의 ID·근거를 확인하고 승인/거절합니다. **가져온 DB의 ID는 원래 PC와 다를 수 있으므로 해당 PC에서 CSV를 다시 내보내 확인하세요.**

```powershell
.\.venv\Scripts\python.exe -m scripts.review export data\review.csv
# 아래 1, 2는 예시입니다. CSV에서 실제로 검수한 ID로 바꾸세요.
.\.venv\Scripts\python.exe -m scripts.review approve 1 2
.\.venv\Scripts\python.exe -m scripts.review reject 3
```

검수 후 다시 JSON을 내보내면 승인 상태도 옮길 수 있습니다. 클라우드에서는 사용할 모델명만 환경변수로 지정한 후, **Ollama 연결 없이** Pages용 사전 파일을 생성합니다.

```bash
export OLLAMA_MODEL='내 PC에서 평가에 사용한 실제 모델명'
PYTHONPATH=backend .venv/bin/python -m scripts.local_evaluate publish
```

Windows에서 생성하려면:

```powershell
.\.venv\Scripts\python.exe -m scripts.local_evaluate publish
```

이 명령은 검수 승인된 결과만 레벨을 부여해 `frontend/src/wordnet.json`, `frontend/public/dictionary/wordnet.sqlite3`, `report.json`을 갱신합니다. 미평가·오류·미검수 자료는 평가 대기로 남깁니다. 생성 파일을 확인해 커밋·푸시하면 기존 GitHub Pages 워크플로가 배포합니다. 방문자는 Ollama를 실행하지 않습니다.

## 선택 사항: PowerShell 실행 도우미

환경변수 OLLAMA_MODEL을 설정한 뒤 아래 도우미를 사용할 수도 있습니다. 실행 정책상 ps1 실행이 제한된 PC에서는 위의 Python 직접 명령을 사용하면 됩니다.

```powershell
.\scripts\evaluate-local.ps1 test
.\scripts\evaluate-local.ps1 all -Timeout 600
.\scripts\evaluate-local.ps1 export -File data\public-evaluations.json
.\scripts\evaluate-local.ps1 import -File C:\path\to\public-evaluations.json
.\scripts\evaluate-local.ps1 publish
```

도우미는 프로젝트 작업 폴더·PYTHONPATH·로컬 Ollama 주소를 설정하고 실행 후 원래 환경으로 돌립니다. `.venv`와 Python 패키지 설치는 처음 한 번 별도로 필요합니다.

## 검증 범위

클라우드에서 실제 Ollama나 사용자 PC에 연결하지 않았습니다. 모의 Ollama 응답으로 시험 평가→전체 재개, 완료 결과 재사용, 실패 재시도, 중단 후 커밋 유지, 다른 모델 재평가, 내보내기/가져오기·중복 방지·입력 검증·개인 기록 보존, 오프라인 게시를 테스트합니다. 실제 모델 응답 품질과 Windows PowerShell 실행은 사용자 PC에서 위의 10개 시험 단계로 확인해야 합니다.
