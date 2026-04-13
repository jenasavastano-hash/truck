@echo off
chcp 65001 >nul
cd /d "%~dp0backend"

if not exist "app.db" (
  echo [1/2] База не найдена. Создаю app.db и тестовых пользователей...
  node init-db.js
  if errorlevel 1 (
    echo Ошибка инициализации БД.
    pause
    exit /b 1
  )
  echo.
)

echo [2/2] Запуск сервера на http://localhost:5000 ...
node server.js
pause
