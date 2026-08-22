$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Python environment missing. Run: python -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt' }
& $python -m uvicorn app.main:app --host 0.0.0.0 --port ($env:PORT ?? '8001') --reload
