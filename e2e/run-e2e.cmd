@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  call npx playwright install chromium
)
echo Running E2E tests...
call npm test
