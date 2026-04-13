@echo off
chcp 65001 >nul
cd /d "%~dp0"

where docker >nul 2>&1
if errorlevel 1 (
  echo Установите Docker Desktop: https://docs.docker.com/get-started/get-docker/
  start "" "https://docs.docker.com/desktop/setup/install/windows-install/"
  pause
  exit /b 1
)

echo Сборка и запуск backend + frontend ^(node:24-slim^)...
echo Остановка: Ctrl+C в этом окне
echo.
docker compose up --build
pause
