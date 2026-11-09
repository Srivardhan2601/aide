@echo off
rem Double-click to start Aide so your phone can use it on home Wi-Fi (pair with the PIN in Settings).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Phone
pause
