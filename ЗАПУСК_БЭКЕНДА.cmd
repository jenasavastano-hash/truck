@echo off
chcp 65001 >nul
call "%~dp0node-path.bat"
cd /d "%~dp0backend"
echo ========================================
echo   Запуск Backend сервера
echo ========================================
echo.

echo [1/2] Проверка зависимостей...
if not exist "node_modules" (
    echo Устанавливаю зависимости...
    call npm install
) else (
    echo ✓ Зависимости установлены
)

echo.
echo [2/2] Запуск Backend сервера...
echo.

node server.js
if errorlevel 1 (
    echo.
    echo ========================================
    echo   ОШИБКА ПРИ ЗАПУСКЕ!
    echo ========================================
    echo Проверьте сообщения об ошибках выше
    pause
    exit /b 1
)
pause
