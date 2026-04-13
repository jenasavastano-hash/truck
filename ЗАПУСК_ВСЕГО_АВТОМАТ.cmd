@echo off
chcp 65001 >nul
echo ========================================
echo   АВТОМАТИЧЕСКИЙ ЗАПУСК ВСЕГО
echo ========================================
echo.

:: Останавливаем старые процессы если есть
echo [0/3] Остановка старых процессов...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM cloudflared.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul

:: Запуск бэкенда
echo [1/3] Запуск Backend сервера...
start "Backend Server" /D "%~dp0backend" cmd /k "npm start"
timeout /t 8 /nobreak >nul

:: Проверка бэкенда
echo Проверка доступности бэкенда...
curl -s http://localhost:5000/api/health >nul 2>&1
if errorlevel 1 (
    echo [ПРЕДУПРЕЖДЕНИЕ] Бэкенд может быть ещё не готов
) else (
    echo ✓ Бэкенд работает
)

:: Запуск Cloudflare Tunnel
echo.
echo [2/3] Запуск Cloudflare Tunnel...
start "Cloudflare Tunnel" /D "%~dp0" cmd /k "cloudflared tunnel --url http://localhost:5000"
timeout /t 10 /nobreak >nul

echo.
echo [3/3] Готово!
echo.
echo ========================================
echo   ВСЁ ЗАПУЩЕНО!
echo ========================================
echo.
echo Backend:     http://localhost:5000
echo.
echo Cloudflare Tunnel запущен в отдельном окне
echo Скопируй URL из окна Cloudflare Tunnel
echo Он будет вида: https://...trycloudflare.com
echo.
echo Затем обнови переменную VITE_API_URL на Netlify:
echo Значение должно быть: https://...trycloudflare.com/api
echo.
echo Или запусти: ОБНОВИТЬ_NETLIFY.cmd новый-url
echo.
pause
