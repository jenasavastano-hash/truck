@echo off
chcp 65001 >nul
cd /d "%~dp0"

if "%~1"=="" (
  if not exist "deploy\keys\deploy_ed25519" (
    echo Использование:
    echo   deploy-full.cmd ^<пароль_SSH^>
    echo   Либо сначала: deploy\install-deploy-key.cmd  затем  deploy-full.cmd -
    exit /b 1
  )
)

if /i "%~1"=="-" set "DEPLOY_PASSWORD="
if not "%~1"=="" if /i not "%~1"=="-" set "DEPLOY_PASSWORD=%~1"
if "%~1"=="" set "DEPLOY_PASSWORD="

if not exist "deploy-config.json" (
  echo Ошибка: нет deploy-config.json — скопируйте deploy-config.example.json и укажите host, user, port.
  exit /b 1
)

if not exist "deploy\deploy.js" (
  echo Ошибка: не найден deploy\deploy.js
  exit /b 1
)

if not exist "deploy\node_modules" (
  echo Устанавливаю зависимости deploy...
  cd /d "%~dp0deploy"
  call npm install
  if errorlevel 1 exit /b 1
  cd /d "%~dp0"
)

echo Запуск деплоя backend + frontend...
if /i "%~2"=="--skip-build" (
  node deploy\deploy.js --full --skip-build
) else (
  node deploy\deploy.js --full
)
