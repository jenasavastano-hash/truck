@echo off
setlocal enabledelayedexpansion
set SHOW_BROWSER=0
if exist "%~dp0signer-client\.workers-display" set /p SHOW_BROWSER=<"%~dp0signer-client\.workers-display"
if "!SHOW_BROWSER!"=="1" set QR_FETCH_HEADLESS=0
cd /d "%~dp0signer-client"
node qr-fetcher.js
