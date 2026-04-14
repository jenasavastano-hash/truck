@echo off
chcp 65001 >nul
cd /d "%~dp0.."
if not exist "deploy\keys\deploy_ed25519.pub" (
  echo Сначала сгенерируйте ключ в deploy\keys\
  exit /b 1
)

set "HOST="
if exist "deploy-config.json" (
  for /f "delims=" %%H in ('node -e "try{const j=JSON.parse(require('fs').readFileSync('deploy-config.json','utf8'));process.stdout.write(String(j.host||'').trim());}catch(e){}"') do set "HOST=%%H"
)
if "%HOST%"=="" set "HOST=212.119.42.239"

echo.
echo ============================================================
echo   КЛЮЧ НА СЕРВЕР  ^(один раз^)
echo   IP берётся из deploy-config.json: %HOST%
echo.
echo   НЕ вставляйте пароль в это окно до команды ssh!
echo   Пароль спросит ОТДЕЛЬНО строка: root@... password:
echo ============================================================
echo.
pause

echo.
echo Подключение: root@%HOST% ...
echo Когда появится запрос пароля — вставьте пароль ROOT с VPS.
echo.

type "deploy\keys\deploy_ed25519.pub" | ssh -o StrictHostKeyChecking=accept-new root@%HOST% "mkdir -p .ssh; chmod 700 .ssh; touch .ssh/authorized_keys; chmod 600 .ssh/authorized_keys; cat >> .ssh/authorized_keys"
if errorlevel 1 (
  echo.
  echo Ошибка. Если вставили пароль в поле IP — запустите скрипт снова: IP подставится сам.
  exit /b 1
)
echo.
echo Готово. Дальше: deploy-full.cmd -
exit /b 0
