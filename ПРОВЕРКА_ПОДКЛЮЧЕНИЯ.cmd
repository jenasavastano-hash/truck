@echo off
chcp 65001 >nul
echo ========================================
echo   ПРОВЕРКА ПОДКЛЮЧЕНИЯ
echo ========================================
echo.

echo [1/3] Проверка локального бэкенда...
curl -s http://localhost:5000/api/health >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Бэкенд не отвечает на localhost:5000
    echo Убедись что:
    echo - Backend сервер запущен
    echo - Порт 5000 свободен
    echo - Нет ошибок в окне Backend Server
    echo.
) else (
    echo ✓ Бэкенд работает на localhost:5000
    echo.
)

echo [2/3] Проверка Cloudflare Tunnel...
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>nul | find /I /N "cloudflared.exe">nul
if errorlevel 1 (
    echo [ОШИБКА] Cloudflare Tunnel не запущен!
    echo Запусти: ЗАПУСК_CLOUDFLARE.cmd
    echo.
) else (
    echo ✓ Cloudflare Tunnel запущен
    echo.
)

echo [3/3] Проверка доступности через Tunnel...
echo Открой окно Cloudflare Tunnel и скопируй URL оттуда
echo Или проверь в логах Tunnel - там должен быть URL вида:
echo https://...trycloudflare.com
echo.
echo Если Tunnel запущен, но URL не работает:
echo 1. Перезапусти Tunnel
echo 2. Скопируй новый URL
echo 3. Обнови переменную VITE_API_URL на Netlify
echo 4. Пересобери сайт
echo.
pause
