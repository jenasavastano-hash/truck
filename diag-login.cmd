@echo off
cd /d "%~dp0deploy"

if not exist "node_modules\ssh2" (
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

node debug-login.js
pause
