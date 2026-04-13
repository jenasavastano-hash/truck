@echo off
chcp 65001 >nul
echo [Сертификаты] Установка сертификатов .pfx с закрытым ключом для подписания ЭПЛ...
echo.

cd /d "%~dp0"
node install-pfx-certificates.js

pause
