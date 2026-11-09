# Start Aide: sets up the backend the first time, then runs it and opens the app.
#   .\start.ps1          normal start (this computer only)
#   .\start.ps1 -Gmail   also read and reply to Gmail (see aide-backend\GMAIL_SETUP.md)
#   .\start.ps1 -Phone   also reachable from your phone on home Wi-Fi (PIN pairing; see Settings)
param([switch]$Gmail, [switch]$Phone)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'aide-backend')

if (-not (Test-Path '.venv\Scripts\python.exe')) {
    Write-Host 'First run: setting up Aide (takes a minute)...'
    python -m venv .venv
}
# Install or update packages whenever requirements.txt changes.
$reqHash = (Get-FileHash 'requirements.txt').Hash
if (-not (Test-Path '.venv\.req-hash') -or (Get-Content '.venv\.req-hash') -ne $reqHash) {
    Write-Host 'Installing packages...'
    & .\.venv\Scripts\python.exe -m pip install -q -r requirements.txt
    Set-Content '.venv\.req-hash' $reqHash
}

if ($Gmail) { $env:AIDE_GMAIL = 'on' }
if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host 'ANTHROPIC_API_KEY is not set, so drafts use built-in templates instead of Claude.' -ForegroundColor Yellow
}

if ($Phone) {
    $env:AIDE_LAN = 'on'
    Write-Host 'Phone access is on for your home Wi-Fi, over a secure (HTTPS) link on port 8443.' -ForegroundColor Cyan
    Write-Host 'If Windows asks about the firewall, allow "Private networks" only.' -ForegroundColor Cyan
    Write-Host 'Then open Settings > Use on your phone, and scan the QR code.' -ForegroundColor Cyan
}

# Open the app once the server answers.
Start-Job {
    foreach ($i in 1..30) {
        try { Invoke-RestMethod 'http://localhost:8000/api/health' | Out-Null; Start-Process 'http://localhost:8000'; break }
        catch { Start-Sleep -Milliseconds 500 }
    }
} | Out-Null

Write-Host 'Aide is running at http://localhost:8000  (press Ctrl+C to stop)' -ForegroundColor Green
if ($Phone) {
    # This computer: http://localhost:8000. Your phone: https://<wifi address>:8443 (see app/serve.py).
    & .\.venv\Scripts\python.exe -m app.serve
} else {
    & .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
}
