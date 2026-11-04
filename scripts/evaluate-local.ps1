param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('test','all','export','import','publish')]
    [string]$Action,
    [string]$File = 'data/public-evaluations.json',
    [int]$Timeout = 180
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (!(Test-Path $python)) { throw '먼저 README의 Python 가상환경 설치 명령을 실행하세요.' }
$oldLocation = Get-Location
$oldPythonPath = $env:PYTHONPATH
$oldOllamaUrl = $env:OLLAMA_URL
try {
    Set-Location $projectRoot
    $env:PYTHONPATH = Join-Path $projectRoot 'backend'
    $env:OLLAMA_URL = 'http://localhost:11434'
    switch ($Action) {
        'test' { & $python -m scripts.local_evaluate run --limit 10 --timeout $Timeout }
        'all' { & $python -m scripts.local_evaluate run --all --timeout $Timeout }
        'export' { & $python -m scripts.local_evaluate export $File }
        'import' { & $python -m scripts.local_evaluate import $File }
        'publish' { & $python -m scripts.local_evaluate publish }
    }
    if ($LASTEXITCODE -ne 0) { throw "평가 명령이 종료 코드 $LASTEXITCODE 로 끝났습니다. 완료 결과는 보존됩니다." }
} finally {
    $env:PYTHONPATH = $oldPythonPath
    $env:OLLAMA_URL = $oldOllamaUrl
    Set-Location $oldLocation
}
