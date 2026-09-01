$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    $python = Join-Path $PSScriptRoot '..\..\venv\Scripts\python.exe'
}
if (-not (Test-Path $python)) { throw 'Python environment missing. Create backend-python\.venv or the workspace root venv, then install backend-python\requirements.txt.' }
& $python -m uvicorn app.main:app --host 0.0.0.0 --port ($env:PORT ?? '8001') --reload
