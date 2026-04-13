@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   АВТОМАТИЧЕСКИЙ ЗАПУСК (УПРОЩЁННЫЙ)
echo ========================================
echo.

:: Запуск бэкенда
echo [1/3] Запуск Backend сервера...
start "Backend Server" /D "%~dp0backend" cmd /k "npm start"
timeout /t 5 /nobreak >nul

:: Запуск Cloudflare Tunnel
echo [2/3] Запуск Cloudflare Tunnel...
start "Cloudflare Tunnel" /D "%~dp0" cmd /k "cloudflared tunnel --url http://localhost:5000"

:: Запуск фронтенда (локально)
echo [3/3] Запуск Frontend...
start "Frontend" /D "%~dp0frontend" cmd /k "npm run dev"

echo.
echo ========================================
echo   ВСЁ ЗАПУЩЕНО!
echo ========================================
echo.
echo Backend:     http://localhost:5000
echo Frontend:    http://localhost:3000
echo.
echo Cloudflare Tunnel URL будет показан в окне Cloudflare Tunnel
echo Скопируй его и обнови переменную VITE_API_URL на Netlify вручную
echo.
echo Для остановки закрой все окна
pause
