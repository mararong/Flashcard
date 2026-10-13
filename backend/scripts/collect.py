import argparse
from pathlib import Path
from app.db import init_db
from app.dictionary import collect_word,wordnet_available,wordnet_entries
from app.difficulty import refresh_frequency


def main():
    parser=argparse.ArgumentParser(description='WordNet 영어 정의 수집 및 Zipf 계산 (중복 안전)')
    parser.add_argument('words',nargs='*')
    parser.add_argument('--file',type=Path,help='한 줄에 영어 단어 하나, UTF-8 텍스트')
    args=parser.parse_args()
    words=list(dict.fromkeys(w.strip().lower() for w in (args.words+(args.file.read_text(encoding='utf-8').splitlines() if args.file else [])) if w.strip()))
    if not words:
        parser.error('단어 또는 --file을 지정해 주세요.')
    if not wordnet_available():
        parser.error('먼저 python -m scripts.prepare_wordnet을 실행해 주세요.')
    init_db()
    for word in words:
        count=collect_word(word)
        lemmas=set(entry[0] for entry in wordnet_entries(word)) or {word}
        for lemma in sorted(lemmas):
            zipf,score=refresh_frequency(lemma)
            print(f'{word} → {lemma}: {count}개 의미 · Zipf {zipf} · 빈도 점수 {score if score is not None else "확인 필요"} · AI 미평가')


if __name__=='__main__':
    main()
