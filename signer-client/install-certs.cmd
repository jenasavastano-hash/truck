@echo off
chcp 65001 >nul
echo [Сертификаты] Установка сертификатов для подписания ЭПЛ...
echo.
cd /d "%~dp0"
node install-certificates.js
pause
