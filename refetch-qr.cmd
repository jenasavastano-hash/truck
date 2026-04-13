@echo off
chcp 65001 >nul
cd /d "%~dp0signer-client"
echo.
echo Перезалив QR (очистка + загрузка с Минтранса)
echo Использование: node refetch-qr-once.js ^<eplId^> или ^<waybill^>
echo Примеры: 129   WB-3-20260214-7361
echo.
set /p ARG="Введи EPL id или waybill: "
if "%ARG%"=="" goto end
node refetch-qr-once.js "%ARG%"
:end
echo.
pause
