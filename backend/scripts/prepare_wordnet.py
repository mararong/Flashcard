"""Download the small dictionary corpus explicitly; never download AI models."""
import hashlib
from pathlib import Path
from nltk.downloader import Downloader
from app.dictionary import wordnet_available
from app.config import ROOT
import os


def prepare_wordnet():
    destination=Path(os.getenv('NLTK_DATA', str(ROOT/'data/nltk')))
    downloader=Downloader(download_dir=str(destination))
    package=downloader.info('wordnet')
    if not downloader.download('wordnet',quiet=False,raise_on_error=True):
        raise RuntimeError('WordNet 다운로드에 실패했습니다.')
    archive=destination/package.subdir/(package.id+'.zip')
    expected=getattr(package,'sha256_checksum',None)
    if not expected:
        raise RuntimeError('공식 NLTK 메타데이터에 SHA-256이 없어 무결성을 확인할 수 없습니다.')
    actual=hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual!=expected:
        raise RuntimeError('WordNet SHA-256 검증에 실패했습니다. 이 데이터를 사용하지 마세요.')
    if not wordnet_available():
        raise RuntimeError('설치한 WordNet을 읽을 수 없습니다.')
    print('WordNet 설치 및 공식 SHA-256 검증 완료. 영어 정의를 사용할 수 있습니다.')


def main():
    prepare_wordnet()


if __name__=='__main__':
    main()
