@echo off
chcp 65001 >nul
echo ========================================
echo   ЗАПУСК ВСЕГО ПРОЕКТА
echo ========================================
echo.
call "%~dp0node-path.bat"
where node >nul 2>&1
if errorlevel 1 (
  echo [ОШИБКА] Node.js не найден. Сначала запустите: УСТАНОВИТЬ_NODE_И_ЗАВИСИМОСТИ.cmd
  pause
  exit /b 1
)

echo [1/2] Запуск Backend сервера...
start "Backend EPL" "%~dp0run-local-backend.cmd"
REM ping вместо timeout — иначе из некоторых IDE/агентов падает с "Input redirection is not supported"
ping -n 4 127.0.0.1 >nul

echo [2/2] Запуск Frontend...
start "Frontend EPL" "%~dp0run-local-frontend.cmd"
ping -n 3 127.0.0.1 >nul

echo.
echo Запуск Cloudflare Tunnel (опционально)...
echo Если нужен публичный доступ - запусти ЗАПУСК_CLOUDFLARE.cmd отдельно

echo.
echo ========================================
echo   ВСЁ ЗАПУЩЕНО!
echo ========================================
echo.
echo Backend:     http://localhost:5000
echo Frontend:    http://localhost:3000
echo Health:      http://localhost:5000/api/health
echo.
echo Для остановки закройте окна командной строки
pause
