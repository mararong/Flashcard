# 단어의 숲 — 영어 플래시카드

한 사람이 자기 컴퓨터에서 실행하는 영어 학습 프로토타입입니다. React + TypeScript + Vite, Python FastAPI, SQLite를 사용합니다. **AI·WordNet·음성 기능이 없어도 개인 단어장, 학습, 저장, 시험은 실행됩니다.**

**내 PC의 Ollama로 10개 시험 평가 → 전체 평가·재개 → 공용 결과를 클라우드로 이동하는 절차:** [Windows PowerShell 실행 안내](docs/LOCAL_OLLAMA.md). 기본 주소는 `http://localhost:11434`이고 모델은 `OLLAMA_MODEL` 환경변수로 지정합니다. 클라우드에서는 가져오기·게시만 수행하며 사용자 PC로 연결하지 않습니다.

## 설치 없이 GitHub Pages에서 사용하기

브라우저 버전 주소: **https://mararong.github.io/Flashcard/**

저장소 소유자는 처음 한 번 [Settings → Pages](https://github.com/mararong/Flashcard/settings/pages)에서 **Build and deployment → Source → GitHub Actions**를 선택하세요. 이후 main에 푸시할 때 `.github/workflows/pages.yml`이 브라우저 모드를 빌드·테스트·배포합니다. 처음 배포는 [Actions](https://github.com/mararong/Flashcard/actions)에서 **Deploy GitHub Pages → Run workflow → main**으로 시작할 수도 있습니다. 배포 작업이 성공한 후 위 주소에서 사용할 수 있습니다. GitHub 플랜과 저장소 공개 범위에 따라 Pages 사용 가능 여부가 다릅니다.

Pages에서는 Python 서버 없이 **IndexedDB**에 단어장, 카드, 중요·잊음 표시, 학습 세션, 시험 답안·결과를 저장합니다. 서버 모드의 SQLite와는 별도의 자료이며 자동으로 옮겨지거나 동기화되지 않습니다. 기기·브라우저가 바뀌면 별도 자료를 사용하고, 브라우저 데이터를 삭제하거나 시크릿 모드를 종료하면 자료를 잃을 수 있습니다.

시험도 브라우저에서 채점합니다. 제출 전 화면과 시험 데이터 응답에는 정답을 넣지 않지만, 브라우저 저장소와 소스에는 정답 자료가 있으므로 서버 채점과 같은 보안 경계는 없습니다. 개인 연습용입니다. WordNet 자동 수집, Zipf 계산, Ollama 평가는 아래의 Python 서버 실행 모드에서 지원합니다. Pages는 필터링한 WordNet 사전을 포함합니다. 공용 레벨 학습·시험에는 5개 항목 평가와 검수를 완료한 의미만 사용합니다. 현재 사전은 AI 평가 대기 상태이며 개인 입력 단어의 학습·시험은 가능합니다.

브라우저 모드를 로컬에서 확인하려면 PowerShell에서:

```powershell
npm --prefix frontend ci
$env:VITE_STORAGE_MODE = "browser"
npm --prefix frontend run build
Remove-Item Env:VITE_STORAGE_MODE
cd frontend
npx vite preview --host 127.0.0.1 --port 4173
```

브라우저 검증은 `frontend`에서 `npm run test:pages`로 실행합니다. 먼저 브라우저 모드로 빌드해야 하며, Playwright Chromium 준비 방법은 아래 테스트 절을 참고하세요. 테스트는 서버 없이 `/Flashcard/` 하위 경로에서 데스크톱·모바일의 등록·저장·복원·채점과 여러 탭의 동시 저장을 확인합니다. 서버 모드를 다시 사용할 때는 `VITE_STORAGE_MODE` 없이 빌드하세요.

## 빠른 시작: Windows PowerShell

Python 3.12와 Node.js 22.12 이상(검증 환경: Python 3.12, Node 24)이 필요합니다. 아래 명령은 모두 저장소 루트에서 실행합니다. 가상환경 활성화나 PowerShell 실행 정책 변경은 필요하지 않습니다.

```powershell
cd C:\path\to\Flashcard
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm --prefix frontend ci
npm --prefix frontend run build
node server.mjs
```

브라우저 주소: `http://127.0.0.1:8000`. FastAPI가 빌드한 화면과 API를 함께 제공합니다. 최초 시작 시 레벨별 10개씩, 총 30개의 **시연용 수동 분류** 단어를 준비합니다. 종료는 터미널에서 `Ctrl+C`입니다.

화면을 수정하며 개발하려면 백엔드를 그대로 실행하고 두 번째 PowerShell에서:

```powershell
cd C:\path\to\Flashcard
npm --prefix frontend run dev
```

개발 화면 주소: `http://127.0.0.1:5173`. Vite가 `/api`를 로컬 백엔드 8000으로 전달합니다. 프런트엔드 변경은 자동 반영됩니다. 백엔드 자동 반영을 원하면 `node server.mjs --reload`로 실행하세요.

## Linux / macOS

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
test -f .env || cp .env.example .env
npm --prefix frontend ci
npm --prefix frontend run build
node server.mjs
```

별도 터미널에서 `npm --prefix frontend run dev`로 개발 화면을 실행할 수 있습니다. 로컬 서버 명령과 기본 설정은 `127.0.0.1`에만 바인딩합니다. GitHub Pages 배포는 위의 별도 브라우저 모드를 사용합니다.

설치 후에는 저장소 루트에서 `node server.mjs`만 실행하면 됩니다. 이 진입점은 Python 백엔드를 시작해 빌드된 화면과 API를 함께 제공합니다. 포트는 기본 8000이며 `PORT` 환경 변수로 변경할 수 있습니다. 개발 화면의 Vite 프록시는 기본 백엔드 포트 8000을 사용합니다.

## 사용 흐름

- **내 단어장**: 생성, 이름 변경, 삭제, 단어 검색, 카드 편집·삭제. 단어+뜻을 직접 입력하거나 엑셀의 두 열을 붙여넣습니다. 여러 단어 입력은 `영어 단어[TAB]뜻`이며, 뜻의 쉼표는 유지합니다. 동일한 단어·뜻·품사만 중복으로 제외합니다. 같은 철자의 다른 의미는 별도 카드입니다.
- **영어만 입력**: 한 줄에 단어 하나. SQLite의 후보를 먼저 찾고 없을 때 설치된 WordNet을 조회합니다. 후보의 품사와 뜻을 확인하고 선택합니다. 못 찾은 뜻은 직접 입력하세요. WordNet 정의는 영어입니다. 한국어 자동 번역은 없습니다.
- **학습**: 내 단어장, 레벨별 공용 단어, 저장 목록, 시험 오답에서 시작합니다. 10·20·전체를 선택하고 무작위로 한 번씩 학습합니다. 카드가 부족하면 실제 개수를 안내합니다. 순서·위치·뒤집기 상태는 서버에 저장해 새로고침 후 복원합니다. 최근 학습을 홈에서 이어갈 수 있습니다.
- **단축키**: Space 뒤집기, ← 이전, → 다음. 입력창·버튼·편집창에 포커스가 있으면 동작하지 않습니다. 스피커 버튼은 영어 음성이 있는 브라우저에서만 읽습니다. 자동 재생은 없으며 연속 클릭 시 이전 재생을 취소합니다.
- **저장**: 중요·잊음을 동시에 선택할 수 있습니다. 전체·중요·잊음 필터, 검색, 저장 해제, 현재 검색 조건으로 다시 학습을 제공합니다. 서버 저장 성공 이후 화면 상태를 갱신합니다.
- **시험**: 개인 단어장 하나 또는 레벨별 공용 단어를 선택합니다. 뜻을 보고 영어를 입력합니다. 허용 정답은 카드 편집에서 한 줄에 하나씩 등록합니다. 서버가 앞뒤 공백 제거·연속 공백 정규화·대소문자 무시 후 정확히 비교합니다. 제출 전에 응답에 정답·허용 정답·정답 단어의 음성을 포함하지 않습니다. 입력한 본인의 답안은 응답에 포함합니다.
- **오답 복습**: 결과에서 오답만 재시험, 오답 카드 학습, 잊음으로 일괄 저장합니다. 중복 제출은 최초 결과를 그대로 돌려주고 완료 시험 횟수를 늘리지 않습니다.

빈 단어장이나 데이터 없는 AI 분류에서는 안내가 나오며 출제를 시작하지 않습니다. 단어장 삭제는 연결만 제거하므로 별도 저장 카드는 유지됩니다. 카드 자체 삭제는 저장 목록에서도 제거됩니다. 기존 학습·시험은 시작 당시의 내용을 보관해 카드가 수정·삭제되어도 복원과 결과 조회가 가능합니다. 삭제된 카드의 새 저장·오답 재시험은 제외됩니다.

## 저장 위치와 백업

기본 DB는 `data/flashcard.sqlite3`, 기본 사전 경로는 `data/nltk`입니다. `.env`의 `FLASHCARD_DB`, `NLTK_DATA`에 절대 경로를 지정할 수 있습니다. 상대 DB 경로는 실행 작업 디렉터리 기준이므로 모든 명령을 저장소 루트에서 실행하세요. 앱을 재시작해도 DB와 기록은 유지됩니다. DB 파일·`.env`는 Git에서 제외합니다.

백업할 때 서버를 종료한 뒤 SQLite 파일을 복사하세요. 실행 중 백업은 SQLite의 backup API를 사용해야 WAL에 남은 자료를 빠뜨리지 않습니다. `data`를 삭제하면 사용자 데이터도 삭제됩니다. 시연 데이터 명령은 사용자 데이터를 삭제하지 않습니다.

**계정이 없는 단일 사용자 앱입니다. 여러 사람이 같은 서버에 접속하면 DB 하나의 자료가 공유됩니다.** API는 신뢰하는 로컬 사용자용이며 접근 제어나 시험 부정행위 방지용 보안 경계가 아닙니다. 로그인, 동기화, 공유 단어장, 자동 간격 반복은 구현 범위에 없습니다.

## WordNet 데이터 준비·수집

WordNet은 약 11MB의 사전 데이터입니다. **레벨별 학습 → 자동 수집·난이도 분류**를 누르면 NLTK WordNet API로 단어를 고르고 정의를 저장한 뒤 Ollama로 난이도를 지정합니다. 사전이 없으면 공식 NLTK 데이터 서버에서 다운로드하며 SHA-256을 검증합니다. Ollama 연결을 먼저 확인하므로 모델이 없을 때 수집만 무작정 진행하지 않습니다.

자동 선정은 빈도대별(Zipf ≥5 / 3.5~5 / 2~3.5) 단어를 교대로 고릅니다. 소문자 영어 단일 단어만 포함하고 고유명사·복합어·빈도 미확인 단어는 제외합니다. 빈도대는 수집의 다양성을 위한 기준이며 최종 난이도는 아래의 다섯 항목으로 계산합니다. 한 번에 1~500단어를 수집할 수 있고 기본은 10단어입니다. 한 단어의 여러 품사·뜻 때문에 학습 카드 수는 단어 수보다 많습니다.

화면에서 진행 상태와 수집·평가·학습 카드 수를 확인할 수 있습니다. 화면을 나가도 서버의 작업은 계속됩니다. 작업 상태는 SQLite에 저장하고 중복 실행은 막습니다. 서버가 재시작되면 중단 상태를 표시하며 다시 실행할 때 미완료 단어부터 이어서 처리합니다. 새 작업은 명시적으로 시작하며 앱 시작만으로 대량 수집하거나 모델을 다운로드하지 않습니다.

명령 한 번으로 실행할 수도 있습니다. 서버와 CLI는 같은 DB의 작업 잠금을 공유합니다.

```powershell
$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m scripts.sync_wordnet --limit 30
```

Linux / macOS: `PYTHONPATH=backend .venv/bin/python -m scripts.sync_wordnet --limit 30`.

특정 단어 목록만 수집하려면 기존 명령도 사용할 수 있습니다.

PowerShell (저장소 루트):

```powershell
$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m scripts.prepare_wordnet
.\.venv\Scripts\python.exe -m scripts.collect apple bank resilience
# UTF-8 파일: 한 줄에 단어 하나
.\.venv\Scripts\python.exe -m scripts.collect --file words.txt
```

Linux / macOS:

```bash
PYTHONPATH=backend .venv/bin/python -m scripts.prepare_wordnet
PYTHONPATH=backend .venv/bin/python -m scripts.collect apple bank resilience
```

수집은 표제어, 품사, 영어 정의, 표제어+WordNet synset 원본 ID, 출처, WordNet 버전, Zipf와 빈도 상태를 저장합니다. 같은 원본 ID로 재수집하면 기존 행을 갱신해 카드와 저장 연결을 유지합니다. 원본 버전이 바뀌면 기존 분류를 해제하고 재평가합니다. 개인 카드는 사전 뜻을 복사해 따로 보관하므로 편집해도 공용 사전은 바뀌지 않습니다. 자동 수집의 유효한 평가 결과는 **AI 자동 분류**로 학습·시험에 바로 사용하며, 사람이 승인한 결과는 **AI · 검수 완료**로 구분합니다. 실패·빈도 미확인 결과는 학습에 추가하지 않습니다. `scripts.collect`만 실행하면 사전 수집만 하고 분류하지 않습니다.

출처: [Princeton WordNet 3.0](https://wordnet.princeton.edu/), [NLTK 인터페이스 및 데이터](https://www.nltk.org/howto/wordnet.html). 데이터 라이선스 원문은 [docs/WORDNET-LICENSE.txt](docs/WORDNET-LICENSE.txt)에 포함합니다. 수집 자료를 재배포할 때 이 고지를 유지하세요. WordNet 조회·수집에는 외부 REST 사전 API나 한국어 번역 API를 사용하지 않습니다.

빈도는 [wordfreq 3.1.1](https://github.com/rspeer/wordfreq)을 사용합니다. 코드와 데이터의 라이선스 및 원천 자료 고지는 [공식 LICENSE](https://github.com/rspeer/wordfreq/blob/v3.1.1/LICENSE.txt)와 [프로젝트 데이터 출처](https://github.com/rspeer/wordfreq#sources-and-acknowledgments)를 참고하세요.

## Ollama 준비와 난이도 기준

유료 API를 사용하지 않고 설치된 Ollama의 로컬 HTTP API에 연결합니다. [Ollama 공식 Windows 설치](https://ollama.com/download/windows) 후 `ollama pull qwen2.5:3b`로 약 1.9GB 모델을 한 번 준비하세요. 다른 OS는 [공식 설치 안내](https://docs.ollama.com/quickstart)를 따릅니다. 모델이 없으면 직접 등록·학습·시험은 그대로 사용할 수 있습니다.

1. Windows 설치 앱은 Ollama 서버를 백그라운드로 실행합니다. 서버가 없다면 별도 터미널에서 `ollama serve`를 실행하고 `ollama list`로 모델을 확인합니다.
2. 루트 `.env`에 `OLLAMA_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=<이미 설치된 모델명>`을 지정합니다. 필요하면 백엔드를 재시작합니다.
3. 백엔드를 재시작하고 레벨별 학습의 자동 수집 버튼이나 `scripts.sync_wordnet`을 실행합니다.

수집과 평가를 따로 실행하고 사람이 먼저 검수하려면 기존 배치 명령을 사용합니다. `scripts.evaluate`만 실행한 결과는 검수 전까지 공개되지 않습니다.

```powershell
$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m scripts.evaluate --limit 20
# 실패한 항목만 재시도
.\.venv\Scripts\python.exe -m scripts.evaluate --retry-failed --limit 20
# 시연 데이터도 실제 AI로 평가할 때만
.\.venv\Scripts\python.exe -m scripts.evaluate --include-demo --limit 30
# 평가 내역을 CSV로 확인하고 ID로 검수
.\.venv\Scripts\python.exe -m scripts.review export data\review.csv
.\.venv\Scripts\python.exe -m scripts.review approve 1 2
.\.venv\Scripts\python.exe -m scripts.review reject 3
```

Linux에서는 `.\.venv\Scripts\python.exe` 대신 `.venv/bin/python`, 각 명령 앞에 `PYTHONPATH=backend`를 사용합니다. 초기 검수는 CSV 확인 + CLI 승인/거절 방식입니다. CSV 내용을 다시 가져와 점수를 덮어쓰는 기능은 제공하지 않습니다.

평가 단위는 **표제어+품사**입니다. AI에는 추상성(0~2), 주요 의미군 복잡도(0~2), 철자·발음 대응을 기억하는 형태 난이도(0~1), 사용 맥락(0~2)의 정수 점수와 짧은 근거를 구조화된 JSON으로 요청합니다. WordNet 의미 개수를 주요 의미군 수로 간주하지 않습니다. 서버는 boolean·실수·범위 초과·누락을 거절하고 정상 점수만 저장합니다. 빈도는 표기 기준이며 품사별 값이 아니라는 사실을 메타데이터에 남깁니다.

빈도 환산 기준은 `backend/difficulty.json`에서 변경 가능합니다. 기본 기준:

| 영어 Zipf | 빈도 점수 |
|---|---|
| ≥ 5 | 0 |
| 4 이상, 5 미만 | 1 |
| 3 이상, 4 미만 | 2 |
| 0 초과, 3 미만 | 3 |
| 0 | 빈도 확인 필요, 레벨 확정 보류 |

서버가 빈도+AI 네 항목을 합산합니다. 0~3점은 L1, 4~6점은 L2, 7~10점은 L3입니다. 모델명, 기준 버전과 설정 해시, 시각, 원본 버전, 빈도 메타데이터, 점수, 근거, 처리 상태, 오류, 검수 상태를 SQLite에 저장합니다. 동일 모델·기준·원본 버전의 완료 결과를 재사용하고 실패 결과는 재시도합니다. 자동 수집은 정상 결과만 자동 분류로 반영하며, 같은 평가를 사람이 승인·거절한 상태는 덮어쓰지 않습니다. Zipf 0은 레벨 확정을 보류하며 수동 빈도 편집 도구는 없습니다. 자동 분류는 CEFR 공인 등급이 아닌 이 앱의 기준에 따른 추정치입니다.

## 테스트

API 테스트는 임시 SQLite DB를 사용합니다. E2E도 별도의 임시 DB와 8001 포트를 사용해 개인 자료를 건드리지 않습니다.

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm --prefix frontend run build
cd frontend
npx playwright install chromium
npm run test:e2e
```

Linux / macOS: `.venv/bin/python -m pytest backend/tests -q`, `npm --prefix frontend run build`, `cd frontend && npx playwright install chromium && npm run test:e2e`. Linux에서 `/usr/bin/chromium`이 있으면 E2E가 이를 우선 사용합니다. `CHROMIUM_PATH`로 실행 경로를 지정할 수도 있습니다. 브라우저 시스템 라이브러리가 부족하면 Playwright 공식 설치 지침에 따라 준비하세요.

실제 검증 결과와 환경 한계는 [docs/VALIDATION.md](docs/VALIDATION.md)에 기록합니다. AI 테스트의 가짜 Ollama 응답은 검증 로직 테스트용이며 실제 AI 분류 결과로 시드하거나 공개하지 않습니다.

## 구조

```text
backend/app/         FastAPI, SQLite, WordNet, 난이도 평가 모듈
backend/scripts/     데이터 준비·수집·배치 평가·검수 명령
backend/tests/       DB/API/평가 검증
frontend/src/        한국어 UI
frontend/tests/      Playwright 데스크톱·모바일 검증
scripts/            테스트 서버 및 클라우드 환경 설치
data/               로컬 SQLite·사전 데이터 (Git 제외)
```

현재 제한: 브라우저의 실제 음성은 OS·브라우저 음성 목록에 따라 달라집니다. AI 모델의 의미 판단 품질은 별도 검수가 필요합니다. 대규모 사전 전수 수집·관리 웹사이트·다중 사용자 운영은 목표가 아닙니다. 기본 시연 단어의 점수는 실제 AI 평가가 아닌 수동 레벨 지정입니다. 서버는 단일 프로세스로 운영하며 동시에 여러 서버를 같은 DB에 연결하지 마세요.


## WordNet 수집 필터와 정확한 레벨 분류

기능어 목록, 표기 검사, WordNet 의미의 고어·희귀 용법·약어 표시, 고유명사 instance 관계와 대문자 원형, 의미별 tagged usage count를 검사합니다. 기본 기능어·약어·기호·고유명사와 용례가 확인되지 않는 의미는 제외하거나 보류합니다. 단어 전체의 빈도가 높아도 그 단어의 드문 의미가 자동 포함되지 않도록 의미별로 검사합니다. 자동 필터의 의미 판단은 완벽하지 않으므로 최종 공개에는 검수가 필요합니다. 필터 버전과 제외 사유별 수치는 `frontend/public/dictionary/report.json`에 기록합니다.

현재 수집량은 10,000 표제어·22,238 의미입니다. 데이터는 `frontend/public/dictionary/wordnet.sqlite3`와 `frontend/src/wordnet.json`에 들어 있습니다. **실제 AI 모델이 연결되지 않아 평가 완료 단어는 0개입니다. 빈도로만 지정했던 이전 레벨은 철회했습니다.** 기존 개인 카드·시험 기록은 보존하며 이전의 임시 공용 카드는 새 학습 출처에서 제외합니다.

분류는 반드시 사용 빈도 0~3 + 추상성 0~2 + 주요 의미군 복잡도 0~2 + 형태 난이도 0~1 + 사용 맥락 0~2의 10점 기준을 사용합니다. 빈도는 설정 파일의 Zipf 구간을 적용하고, 나머지 네 항목은 실제 AI의 JSON 정수 점수와 근거를 검증합니다. 0~3은 L1, 4~6은 L2, 7~10은 L3입니다. 빈도 미확인·AI 미평가·오류·검수 미완료 항목에 임시 레벨을 부여하지 않습니다.

평가 단위는 표제어+품사입니다. 평가에 사용한 정의 집합·필터 정책을 원본 버전 해시에 포함해 의미 구성이 바뀌면 이전 결과를 재사용하지 않습니다. 모델·평가 기준 버전·상태·오류·시각·점수·근거는 evaluations에 보존합니다. 같은 조건의 완료 결과는 재사용하고 실패한 결과는 다음 실행에서 재시도합니다.

기존에 설치된 Ollama 모델을 .env의 OLLAMA_MODEL과 OLLAMA_URL에 지정한 후 저장소 루트에서:

```bash
PYTHONPATH=backend .venv/bin/python -m scripts.prepare_wordnet
# 수집만: 평가 대기 자료 생성
PYTHONPATH=backend .venv/bin/python -m scripts.build_catalog
# 실제 5개 항목 평가 (처음에는 작은 배치로 검증)
PYTHONPATH=backend .venv/bin/python -m scripts.build_catalog --evaluate --limit 20
PYTHONPATH=backend .venv/bin/python -m scripts.review export data/review.csv
PYTHONPATH=backend .venv/bin/python -m scripts.review approve <검수한_평가_ID>
# 같은 모델의 승인된 결과만 공개 카탈로그에 반영
PYTHONPATH=backend .venv/bin/python -m scripts.build_catalog
```

Windows에서는 PYTHONPATH를 PowerShell 환경변수로 지정하고 `.venv/bin/python`을 `.\.venv\Scripts\python.exe`로 바꿉니다. 모델을 자동 다운로드하거나 유료 API를 호출하지 않습니다. 생성된 카탈로그를 커밋·배포하면 방문자는 별도 AI 실행 없이 사전 평가된 단어로 학습합니다.
