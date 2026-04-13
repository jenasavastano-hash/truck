@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Quick Panel - Netlify/Backend/Workers
cd /d "%~dp0"

:menu
echo ========================================
echo   QUICK PANEL - TaxiSite
echo ========================================
echo.
echo  1) Deploy FRONT to Netlify (PROD)
echo  2) Start/Restart BACKEND (opens new window)
echo  3) Start/Restart WORKERS (opens new window)
echo  4) Start ALL (backend + workers) + deploy front
echo.
echo  5) Open Netlify site
echo  6) Check server (API_URL/api/health)
echo  0) Exit
echo.
set /p choice=Select (0-6): 

if "%choice%"=="1" goto deploy_front
if "%choice%"=="2" goto start_back
if "%choice%"=="3" goto start_workers
if "%choice%"=="4" goto start_all
if "%choice%"=="5" goto open_site
if "%choice%"=="6" goto check_server
if "%choice%"=="0" goto end
goto menu

:deploy_front
echo.
echo [FRONT] Deploying to Netlify (production)...
echo.
call npm run deploy:prod
echo.
pause
goto menu

:start_back
echo.
echo [BACK] Starting backend...
echo.
start "Backend" "%~dp0start-backend.cmd"
echo.
pause
goto menu

:start_workers
echo.
echo [WORKERS] Starting workers...
echo.
start "Workers" "%~dp0start-universal-workers.cmd"
echo.
pause
goto menu

:start_all
echo.
echo [ALL] Starting backend + workers...
echo.
start "Backend" "%~dp0start-backend.cmd"
start "Workers" "%~dp0start-universal-workers.cmd"
echo.
echo [ALL] Deploying front to Netlify (production)...
echo.
call npm run deploy:prod
echo.
pause
goto menu

:open_site
echo.
echo Opening Netlify site...
echo.
start "" "https://astounding-mooncake-f09034.netlify.app"
echo.
pause
goto menu

:check_server
echo.
echo [CHECK] Reading API_URL from signer-client\.env...
echo.
set "API_URL="
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /i "^API_URL=" "%~dp0signer-client\.env"`) do set "API_URL=%%B"

if not defined API_URL (
  echo ERROR: API_URL not found in signer-client\.env
  echo.
  pause
  goto menu
)

set "HEALTH_URL=%API_URL%/api/health"
echo API_URL   = %API_URL%
echo HEALTH    = %HEALTH_URL%
echo.
echo Opening health in browser...
start "" "%HEALTH_URL%"
echo.
echo Trying curl (if available)...
echo.
curl -sS "%HEALTH_URL%"
echo.
echo.
pause
goto menu

:end
endlocal
exit /b 0
