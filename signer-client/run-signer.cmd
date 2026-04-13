@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Автоподпись титулов ЭПЛ (Т2, Т3, Т4) на этом ПК.
echo Требуется: .env с API_URL и SIGNER_API_KEY, КриптоПро и сертификаты.
echo.
if not exist "node_modules" (
  echo Установка зависимостей...
  call npm install
)
node sign.js
pause
