@echo off
chcp 65001 >nul
setlocal EnableExtensions

echo ========================================
echo   1) Node.js + npm
echo   2) npm install: backend + frontend
echo ========================================
echo.

call "%~dp0node-path.bat"

where node >nul 2>&1
if %errorlevel% equ 0 goto :npm_deps

echo [!] node не найден. Пробуем установить Node.js LTS...
echo.

set "WINGET="
if exist "%LocalAppData%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LocalAppData%\Microsoft\WindowsApps\winget.exe"
if exist "%ProgramFiles%\WindowsApps\winget.exe" set "WINGET=%ProgramFiles%\WindowsApps\winget.exe"

if defined WINGET (
  echo Запуск: winget install OpenJS.NodeJS.LTS ...
  "%WINGET%" install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo.
    echo winget не смог установить. Откроется страница nodejs.org — скачайте LTS и установите вручную.
    start "" "https://nodejs.org/ru/download/"
    echo После установки закройте ВСЕ окна cmd, откройте новое и снова запустите этот файл.
    pause
    exit /b 1
  )
  call "%~dp0node-path.bat"
) else (
  echo winget не найден. Откройте https://nodejs.org/ и установите вариант LTS ^(включите опцию Add to PATH^).
  start "" "https://nodejs.org/ru/download/"
  echo Затем закройте окна cmd и снова запустите этот файл.
  pause
  exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo Node всё ещё не в PATH. Закройте это окно, откройте НОВЫЙ cmd от имени пользователя и снова запустите скрипт.
  echo Либо перезагрузите ПК после установки Node.
  pause
  exit /b 1
)

:npm_deps
echo.
echo [OK] node:
where node
node -v
npm -v
echo.

echo [1/2] backend: npm install ...
cd /d "%~dp0backend"
call npm install
if errorlevel 1 (
  echo Ошибка npm install в backend.
  pause
  exit /b 1
)

echo.
echo [2/2] frontend: npm install ...
cd /d "%~dp0frontend"
call npm install
if errorlevel 1 (
  echo Ошибка npm install в frontend.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Готово. Дальше: ЗАПУСК_ВСЕГО.cmd
echo   Сайт: http://127.0.0.1:3000
echo ========================================
pause
exit /b 0
