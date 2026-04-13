@echo off
chcp 65001 >nul
call "%~dp0node-path.bat"
cd /d "%~dp0frontend"
echo Frontend: http://127.0.0.1:3000
call npm run dev
pause
