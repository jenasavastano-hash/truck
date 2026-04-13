@echo off
chcp 65001 >nul
call "%~dp0node-path.bat"
cd /d "%~dp0backend"
echo Backend: http://localhost:5000
node server.js
pause
