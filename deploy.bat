@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo === Деплой на сервер ===
echo.

if not exist "deploy\deploy.js" (
  echo Ошибка: не найден deploy\deploy.js
  echo Запускай из корня проекта "Сайт Такси1".
  goto end
)

where node >nul 2>&1
if errorlevel 1 (
  echo Ошибка: Node.js не найден. Установи Node.js и добавь в PATH.
  goto end
)

cd /d "%~dp0deploy"
echo Папка: %CD%
echo.

if not exist "node_modules" (
  echo Установка ssh2...
  call npm install
  if errorlevel 1 (
    echo Ошибка npm install.
    goto end
  )
  echo.
)

echo Запуск деплоя...
echo.
call node deploy.js

:end
echo.
echo === Конец. Нажми любую клавишу ===
pause >nul
