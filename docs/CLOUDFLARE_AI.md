# 로컬 설치 없이 Cloudflare AI로 단어 평가하기

GitHub Actions가 저장소에 포함된 WordNet 사전을 읽고, Cloudflare Workers AI에 표제어+품사별 평가를 요청합니다. Python이 사용 빈도 점수와 AI 네 항목을 합산해 SQLite에 저장합니다. 학습 앱은 미리 평가·검수된 데이터만 배포받으므로 방문자가 AI나 Python을 설치하지 않아도 됩니다.

## 처음 한 번 설정

1. Cloudflare 계정에서 **Workers Free 플랜**을 사용합니다. 유료 플랜이나 유료 전용 모델로 자동 전환하는 기능은 구현하지 않습니다.
2. Cloudflare의 Account ID를 확인합니다.
3. Cloudflare 대시보드의 **My Profile → API Tokens → Create Token**에서 **Workers AI** 템플릿을 사용합니다. 사용자 지정 토큰을 만들면 해당 계정의 **Workers AI Read와 Edit 권한 모두**가 필요합니다. 계정 범위는 사용할 계정으로 제한합니다.
4. GitHub 저장소의 **Settings → Secrets and variables → Actions → Secrets → New repository secret**에서 다음 두 항목을 등록합니다.

| 이름 | 값 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | 위에서 만든 API 토큰 |

토큰을 채팅, 소스 코드, 브라우저 환경변수 또는 프런트엔드 파일에 넣지 마세요. 이 워크플로는 GitHub Secrets를 평가 단계에서만 사용합니다.

기본 모델은 `@cf/meta/llama-3.1-8b-instruct`입니다. 모델을 변경하려면 **Settings → Secrets and variables → Actions → Variables**에 `CLOUDFLARE_MODEL`을 등록합니다. 프로젝트에서 지원하는 무료 대상 모델만 사용할 수 있으며, 지원하지 않는 모델은 자동 대체하지 않습니다. 모델이 달라지면 이전 모델 평가와 구분해 새 결과로 처리합니다.

공식 안내: [Workers AI REST API 설정](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [무료 할당량과 가격](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## 10개 시험 평가

1. GitHub 저장소의 **Actions → Evaluate words with Cloudflare AI → Run workflow**를 엽니다.
2. Branch는 **main**, `operation`은 **evaluate**, `limit`는 **10**, `max_requests`는 **20**을 선택합니다. `approved_ids`는 비워 둡니다.
3. 실제 Cloudflare 계정의 Free 플랜을 확인하고 `free_plan_confirmed` 확인란을 선택합니다.
4. **Run workflow**를 누릅니다.

첫 10개 **표제어**가 대상이며 품사가 여러 개이면 각각 평가합니다. AI 요청 한도를 20으로 선택하면 이번 실행에서 최대 20개 표제어+품사 요청까지만 수행합니다. 모두 완료되지 않아도 같은 설정으로 다시 실행하면 완료 결과를 재사용하고 나머지를 이어서 평가합니다.

완료된 실행을 열어 Artifacts의 `cloudflare-public-evaluations-실행번호`를 내려받으면 점수와 근거를 담은 `cloudflare-review.csv`와 모델별 결과 JSON을 볼 수 있습니다. CSV에는 평가 ID, 단어·품사, 모델, 점수, 레벨, 검수 상태 등이 포함됩니다. 실제 점수 품질을 확인한 후 전체 작업으로 확대하세요.

## 전체 사전 평가와 무료 한도

시험 결과를 확인했으면 `limit`를 **10000**으로 바꾸고 `max_requests`를 **20~300** 중에서 선택해 실행합니다. 매번 전체 후보에서 이미 완료된 같은 모델·기준·원본 버전의 결과를 건너뛰므로, 요청 수를 작게 유지해 여러 번 실행해도 됩니다. 단어장·사용자의 저장/시험 기록은 평가 대상으로 사용하지 않습니다.

무료 할당량은 **단어 수가 아닌 모델 사용량(Neurons)** 기준입니다. 하루 10,000 Neurons의 실제 단어 처리 수는 모델·입출력 길이에 따라 달라집니다. 무료 플랜에서 한도 초과나 요청 제한을 만나면 작업을 멈추고 다음 실행에서 이어서 처리합니다. 무료 한도를 늘리려고 유료 모델로 바꾸거나 결제를 활성화하지 않습니다. 계정이 실제로 Free 플랜인지 확인란만으로 서버 측 검증할 수는 없으므로 Cloudflare 대시보드에서 확인해야 합니다.

이 워크플로는 **수동 실행만** 지원합니다. 예약 실행이나 한도 초과 시 즉시 반복 실행은 하지 않습니다. 일일 한도를 사용했다면 다음 일일 한도 초기화 이후 다시 실행하세요. 일시적인 요청 제한일 때도 작업 상태를 보존하고 나중에 재개할 수 있습니다.

## 중단·실패 후 이어서 처리

- 평가 하나가 끝날 때마다 결과를 실행 중 SQLite에 커밋합니다.
- 정상 종료, 요청 수 제한, 무료 한도 중단 또는 일반적인 오류 시 JSON 체크포인트를 생성합니다.
- 워크플로의 마지막 저장 단계는 성공/실패와 관계없이 이 공용 결과를 별도 **`ai-data` 브랜치의 `cloudflare-results-모델해시.json`**에 보관합니다. 모델별로 다른 파일을 사용하므로 모델을 바꿔도 이전 모델의 체크포인트를 덮어쓰지 않습니다.
- 다음 실행은 이 파일을 복원해 SQLite로 가져온 뒤 미완료 항목만 처리합니다. CSV/다운로드 artifact의 보관 기한과 관계없이 데이터 브랜치가 체크포인트를 유지합니다.
- 작업을 동시에 실행해 데이터가 덮어써지지 않도록 워크플로 실행은 순서대로 대기합니다. 다른 모델로 변경해도 이전 모델 결과를 삭제하지 않고 보존하도록 체크포인트를 관리합니다.

GitHub에서 작업을 강제 취소하거나 실행 머신이 갑자기 종료되면 마지막 브랜치 저장 단계가 실행되지 않을 수 있습니다. 이때는 **직전에 `ai-data` 브랜치에 저장된 묶음까지** 복원되며, 저장되지 못한 마지막 묶음은 재평가할 수 있습니다. 작은 `max_requests` 값으로 운영하면 한 번에 잃을 수 있는 작업량을 줄일 수 있습니다.

## 분류 기준과 공개

평가 기준은 기존과 같습니다. Python이 계산하는 빈도 0~3점에, AI가 평가한 추상성 0~2·주요 의미군 복잡도 0~2·형태 0~1·사용 맥락 0~2점을 더합니다. 정수·범위·근거를 검증한 뒤 합계 0~3→L1, 4~6→L2, 7~10→L3으로 분류합니다. 빈도만으로 임시 레벨을 부여하지 않습니다.

**평가 성공과 검수 승인은 구분합니다.** `operation=evaluate`의 결과는 검수 대기로 저장하며 자동 승인하거나 학습 사이트에 게시하지 않습니다. CSV에서 점수·근거를 확인하고 명시적으로 승인한 결과만 게시용 사전에 포함합니다. 테스트용 모의 응답은 실제 공용 데이터로 사용하지 않습니다.

## GitHub 웹에서 검수 결과 승인·게시

로컬 개발 환경이 없어도 다음 단계로 진행할 수 있습니다.

1. **가장 최근 실행**의 Artifacts에서 `cloudflare-review.csv`를 열고 승인할 단어의 점수·근거를 확인합니다. 모델이 바뀌면 해당 모델의 최신 CSV를 사용합니다.
2. **Actions → Evaluate words with Cloudflare AI → Run workflow**에서 Branch **main**, `operation` **publish**를 선택합니다.
3. `approved_ids`에 실제로 확인한 CSV의 평가 ID를 쉼표 또는 공백으로 구분해 입력합니다. 예: `1,2,3`. 처음부터 전체를 자동 승인하지 않습니다. 기존 승인 결과만 다시 게시하려면 비워 둘 수 있습니다.
4. **Run workflow**를 누릅니다. publish는 AI를 호출하지 않으므로 Cloudflare API 토큰이나 무료 플랜 확인란이 필요하지 않습니다. `limit`와 `max_requests`도 사용하지 않습니다.
5. 성공하면 승인 상태를 데이터 브랜치에 저장하고 승인된 단어만 포함한 공용 사전 파일 3개를 main에 커밋합니다.
6. **Actions → Deploy GitHub Pages → Run workflow → main**으로 사이트를 배포합니다. GitHub Actions의 기본 토큰으로 만든 커밋은 다른 push 워크플로를 자동 실행하지 않으므로 이 배포는 직접 실행해야 합니다.

`approved_ids`는 모델·분류 기준이 같은 정상 평가인지 확인한 뒤 적용합니다. CSV는 체크포인트를 새 DB에 복원해 생성하므로 다음 publish 실행의 ID와 대응합니다. 다만 이후 새 평가를 실행했거나 모델을 바꿨다면 **새 CSV에서 ID를 다시 확인**하세요. publish 실행 중 main이 다른 작업으로 변경되면 푸시를 강제로 덮어쓰지 않고 실패합니다. 최신 main에서 다시 실행하면 됩니다.

## 선택 사항: 클라우드 개발 환경의 명령으로 검수·게시

공용 결과 JSON은 기존 내보내기/가져오기 형식과 호환됩니다. 클라우드 개발 환경에서 이어서 검수·게시할 수 있습니다. 아래는 저장소 루트, Python 의존성 설치 후의 예입니다. 이 단계에서는 Cloudflare 토큰이나 Ollama 연결이 필요 없습니다.

```bash
export PYTHONPATH=backend
python -m scripts.local_evaluate import /path/to/cloudflare-results-모델해시.json
python -m scripts.review export data/review.csv
# 아래 숫자는 해당 DB의 CSV에서 실제로 확인한 평가 ID로 바꿉니다.
python -m scripts.review approve 1 2
python -m scripts.cloudflare_evaluate publish
```

게시 시 평가한 모델이 기본 모델과 다르다면 `CLOUDFLARE_MODEL`도 같은 값으로 설정해야 합니다. 게시 명령은 `cloudflare:<모델명>`으로 저장된 승인 결과를 사용해 `frontend/src/wordnet.json`, 공용 SQLite, 보고서를 갱신합니다. 생성 파일을 검토해 main에 커밋·푸시하면 기존 Pages 배포가 실행됩니다. 생성한 공용 사전 파일에 토큰은 포함되지 않습니다.

위 Python 명령은 선택 사항입니다. GitHub 웹의 evaluate/publish 작업만으로 수집된 자료의 평가·보존·명시적 승인·배포를 진행할 수 있습니다. 검수 전 결과가 방문자의 학습 데이터로 공개되지는 않습니다.

## 검증 범위

워크플로 YAML, Bash 구문과 Python heredoc, 승인 ID의 숫자 형식을 검사했습니다. 외부 연결 없는 임시 Git 저장소에서 `ai-data` 최초 생성·후속 저장·변경 없는 재실행·다른 모델 파일 보존과 main 유지도 확인했습니다. Cloudflare 실계정 토큰이 아직 설정되지 않아 실제 API 평가 및 GitHub Actions 원격 실행은 검증하지 않았습니다. Secrets 등록 후 위의 10개 시험 평가로 실제 모델 응답 품질과 계정 한도를 확인하세요.
