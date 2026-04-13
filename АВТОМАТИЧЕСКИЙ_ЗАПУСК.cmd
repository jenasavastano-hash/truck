@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   АВТОМАТИЧЕСКИЙ ЗАПУСК ВСЕГО ПРОЕКТА
echo ========================================
echo.

:: Проверка переменных окружения (загружаем из .env если есть)
if exist "%~dp0.env" (
    echo Загрузка переменных из .env...
    for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0.env") do (
        set "%%a=%%b"
    )
)

if not defined NETLIFY_SITE_ID (
    echo [ПРЕДУПРЕЖДЕНИЕ] NETLIFY_SITE_ID не установлен
    echo Автоматическое обновление Netlify будет пропущено
    echo Создай .env файл с NETLIFY_SITE_ID и NETLIFY_API_TOKEN для полной автоматизации
    set SKIP_NETLIFY=1
)

if not defined NETLIFY_API_TOKEN (
    echo [ПРЕДУПРЕЖДЕНИЕ] NETLIFY_API_TOKEN не установлен
    set SKIP_NETLIFY=1
)

:: Запуск бэкенда
echo [1/4] Запуск Backend сервера...
start "Backend Server" /D "%~dp0backend" cmd /k "npm start"
timeout /t 5 /nobreak >nul

:: Запуск Cloudflare Tunnel и получение URL
echo.
echo [2/4] Запуск Cloudflare Tunnel и получение URL...
cd /d "%~dp0"

:: Создаём временный файл для логов
set TUNNEL_LOG=%~dp0tunnel_output.log
del "%TUNNEL_LOG%" >nul 2>&1

:: Запускаем cloudflared (URL — в окне туннеля; авто-парсинг лога ниже может не сработать без записи в файл)
start "Cloudflare Tunnel" /min /D "%~dp0" cmd /k cloudflared tunnel --url http://localhost:5000

:: Ждём появления URL
echo Ожидание создания туннеля (до 30 секунд)...
set TUNNEL_URL=
set COUNTER=0

:wait_loop
timeout /t 2 /nobreak >nul
set /a COUNTER+=2

:: Ищем URL в логе
for /f "tokens=*" %%a in ('type "%TUNNEL_LOG%" 2^>nul ^| findstr /C:"trycloudflare.com"') do (
    :: Извлекаем URL из строки
    for /f "tokens=*" %%b in ('echo %%a') do (
        set LINE=%%b
        :: Ищем https://
        echo !LINE! | findstr /C:"https://" >nul
        if not errorlevel 1 (
            :: Извлекаем URL между пробелами или в скобках
            for /f "tokens=2 delims= " %%c in ("!LINE!") do (
                set TUNNEL_URL=%%c
            )
            :: Убираем лишние символы
            set TUNNEL_URL=!TUNNEL_URL:(=!
            set TUNNEL_URL=!TUNNEL_URL:)=!
            set TUNNEL_URL=!TUNNEL_URL: =!
        )
    )
)

if defined TUNNEL_URL (
    echo ✓ Туннель создан: !TUNNEL_URL!
    goto tunnel_found
)

if !COUNTER! geq 30 (
    echo [ОШИБКА] Таймаут ожидания туннеля
    echo Проверь окно Cloudflare Tunnel вручную - там должен быть URL
    echo Или проверь файл: %TUNNEL_LOG%
    goto manual_mode
)

goto wait_loop

:tunnel_found
:: Формируем API URL
set API_URL=!TUNNEL_URL!/api
echo API URL: !API_URL!
echo.

:: Обновление Netlify (если настроено)
if not defined SKIP_NETLIFY (
    echo [3/4] Обновление переменной окружения на Netlify...
    
    :: Используем PowerShell для работы с JSON
    powershell -Command "$body = @{key='VITE_API_URL'; values=@(@{value='!API_URL!'; context='production'})} | ConvertTo-Json -Depth 10; Invoke-RestMethod -Uri 'https://api.netlify.com/api/v1/sites/%NETLIFY_SITE_ID%/env' -Method Post -Headers @{Authorization='Bearer %NETLIFY_API_TOKEN%'; 'Content-Type'='application/json'} -Body $body" >nul 2>&1
    
    if errorlevel 1 (
        echo [ПРЕДУПРЕЖДЕНИЕ] Не удалось обновить автоматически
        goto manual_netlify
    ) else (
        echo ✓ Переменная VITE_API_URL обновлена
        
        :: Запуск передеплоя
        echo [4/4] Запуск передеплоя Netlify...
        powershell -Command "Invoke-RestMethod -Uri 'https://api.netlify.com/api/v1/sites/%NETLIFY_SITE_ID%/builds' -Method Post -Headers @{Authorization='Bearer %NETLIFY_API_TOKEN%'} -Body (@{clear_cache=$true} | ConvertTo-Json)" >nul 2>&1
        
        if errorlevel 1 (
            echo [ПРЕДУПРЕЖДЕНИЕ] Не удалось запустить передеплой автоматически
        ) else (
            echo ✓ Передеплой запущен
        )
    )
) else (
    echo [3/4] Пропуск автоматического обновления Netlify
    goto manual_netlify
)

goto done

:manual_netlify
echo.
echo ========================================
echo   РУЧНОЕ ОБНОВЛЕНИЕ NETLIFY
echo ========================================
echo.
echo 1. Зайди в Netlify Dashboard:
echo    https://app.netlify.com/sites/%NETLIFY_SITE_ID%/configuration/env
echo.
echo 2. Найди или создай переменную: VITE_API_URL
echo.
echo 3. Установи значение: !API_URL!
echo.
echo 4. Сохрани и пересобери сайт:
echo    Deploys ^> Trigger deploy ^> Deploy site
echo.
goto done

:manual_mode
echo.
echo ========================================
echo   РУЧНОЙ РЕЖИМ
echo ========================================
echo.
echo 1. Открой окно Cloudflare Tunnel
echo 2. Скопируй URL (должен быть вида: https://...trycloudflare.com)
echo 3. Обнови переменную VITE_API_URL на Netlify
echo.
goto done

:done
echo.
echo ========================================
echo   ВСЁ ЗАПУЩЕНО!
echo ========================================
echo.
echo Backend:     http://localhost:5000
if defined TUNNEL_URL (
    echo Tunnel:     !TUNNEL_URL!
    echo API:        !API_URL!
)
echo.
echo Netlify Dashboard:
if defined NETLIFY_SITE_ID (
    echo https://app.netlify.com/sites/%NETLIFY_SITE_ID%/deploys
) else (
    echo https://app.netlify.com
)
echo.
echo Для остановки закрой окна:
echo - Backend Server
echo - Cloudflare Tunnel
echo.
pause
