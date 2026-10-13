#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
FLASHCARD_CACHE_DIR="${FLASHCARD_CACHE_DIR:-/tmp/flashcard-cache}"
mkdir -p "$FLASHCARD_CACHE_DIR"
python3 -m venv .venv
.venv/bin/python -m pip install --cache-dir "$FLASHCARD_CACHE_DIR/pip" -r backend/requirements.lock
npm --prefix frontend ci --cache "$FLASHCARD_CACHE_DIR/npm"
npm --prefix frontend run build
PYTHONPATH=backend .venv/bin/python -m scripts.seed_demo
PYTHONPATH=backend .venv/bin/python -m scripts.prepare_wordnet
printf '설치 완료. README의 로컬 실행 명령을 사용하세요.\n'
