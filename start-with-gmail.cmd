@echo off
rem Double-click to start Aide with Gmail connected (set it up first: aide-backend\GMAIL_SETUP.md).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Gmail
pause
