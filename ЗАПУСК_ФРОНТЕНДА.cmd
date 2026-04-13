@echo off
chcp 65001 >nul
call "%~dp0node-path.bat"
cd /d "%~dp0frontend"
echo ========================================
echo   Запуск Frontend
echo ========================================
echo.
npm run dev
pause
