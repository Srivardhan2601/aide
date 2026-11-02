# Start Aide: sets up the backend the first time, then runs it and opens the app.
#   .\start.ps1          normal start
#   .\start.ps1 -Gmail   also read and reply to Gmail (see aide-backend\GMAIL_SETUP.md)
param([switch]$Gmail)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'aide-backend')

if (-not (Test-Path '.venv\Scripts\python.exe')) {
    Write-Host 'First run: setting up Aide (takes a minute)...'
    python -m venv .venv
    & .\.venv\Scripts\python.exe -m pip install -q -r requirements.txt
}

if ($Gmail) { $env:AIDE_GMAIL = 'on' }
if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host 'ANTHROPIC_API_KEY is not set, so drafts use built-in templates instead of Claude.' -ForegroundColor Yellow
}

# Open the app once the server answers.
Start-Job {
    foreach ($i in 1..30) {
        try { Invoke-RestMethod 'http://localhost:8000/api/health' | Out-Null; Start-Process 'http://localhost:8000'; break }
        catch { Start-Sleep -Milliseconds 500 }
    }
} | Out-Null

Write-Host 'Aide is running at http://localhost:8000  (press Ctrl+C to stop)' -ForegroundColor Green
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
