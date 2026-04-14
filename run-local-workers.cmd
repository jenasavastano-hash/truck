@echo off
chcp 65001 >nul
call "%~dp0node-path.bat" 2>nul
cd /d "%~dp0"

if not exist "signer-client\.env" (
  echo [signer-client] Нет .env — копирую из .env.example
  copy /Y "signer-client\.env.example" "signer-client\.env" >nul
  echo.
  echo 1^) В backend\.env и signer-client\.env должен быть ОДИН И ТОТ ЖЕ ключ:
  echo     node backend\generate-signer-key.js
  echo     Скопируйте SIGNER_API_KEY=... в оба файла.
  echo 2^) Заполните TAKSKOM_* логины и CHROMIUM_GOST_PATH / TAXCOM_USER_DATA_DIR.
  echo 3^) Для грузовых в ЛК: см. TAXCOM_COMMERCIAL_SHIPPING_LABEL, TAXCOM_TRIP_START_LABEL,
  echo    TAXCOM_SHIPPING_KIND_LABEL, TAXCOM_MESSAGE_KIND_LABEL в signer-client\.env
  echo.
)

cd signer-client

REM Бэкенд: http://localhost:5000 ^(запустите отдельно run-local-backend.cmd^)
if not defined API_URL set "API_URL=http://localhost:5000"

REM Один процесс: очередь clinic + полный цикл Т1-T4 + PDF/QR ^(рекомендуется для грузовых тестов^)
REM set USE_EPL_PRODUCTION_WORKER=1

REM Четыре процесса: dispatcher, medic, mechanic, qr-fetcher
node run-workers.js
exit /b %ERRORLEVEL%
