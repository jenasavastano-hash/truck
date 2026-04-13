@echo off
chcp 65001 >nul
echo ========================================
echo   Деплой на Netlify
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Проверка зависимостей...
if not exist "node_modules" (
    echo Устанавливаю зависимости...
    call npm install
) else (
    echo ✓ Зависимости установлены
)

echo.
echo [2/3] Сборка проекта...
call npm run build

if errorlevel 1 (
    echo ❌ Ошибка сборки!
    pause
    exit /b 1
)

if not exist "dist" (
    echo ❌ Папка dist не создана!
    pause
    exit /b 1
)

echo ✓ Проект собран

echo.
echo [3/3] Деплой на Netlify...

REM Проверяем, связан ли проект
netlify status >nul 2>&1
if errorlevel 1 (
    echo.
    echo ⚠ Проект не связан с Netlify
    echo Связываю с существующим проектом "tvoyputevoy"...
    echo.
    REM Пробуем связать по имени
    call netlify link --name tvoyputevoy
    if errorlevel 1 (
        echo.
        echo ⚠ Не удалось автоматически связать проект
        echo Попробуй вручную:
        echo   1. Выполни: netlify link --name tvoyputevoy
        echo   2. Или: netlify link (и найди проект в списке)
        echo   3. Или найди Site ID в Netlify Dashboard и выполни:
        echo      netlify link --id ТВОЙ_SITE_ID
        pause
        exit /b 1
    )
    echo.
    echo ✓ Проект успешно связан!
    echo.
)

echo Деплою на production...
call netlify deploy --prod

if errorlevel 1 (
    echo.
    echo ❌ Ошибка деплоя!
    echo.
    echo Если видишь "command not found":
    echo   1. Установи: npm install -g netlify-cli
    echo   2. Залогинься: netlify login
    echo   3. Запусти снова: deploy.cmd
    echo.
    echo Если проект не связан:
    echo   1. Выполни: netlify link
    echo   2. Выбери проект "tvoyputevoy"
    echo   3. Запусти снова: deploy.cmd
) else (
    echo.
    echo ========================================
    echo   ✓ Деплой завершён успешно!
    echo ========================================
    echo.
    echo Сайт доступен по адресу:
    echo https://tvoyputevoy.netlify.app
    echo.
    echo Для Telegram Mini App используй этот URL!
)

echo.
pause
