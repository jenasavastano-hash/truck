@echo off
cd /d "%~dp0frontend"
echo Fixing npm ECOMPROMISED...
del package-lock.json 2>nul
rmdir /s /q node_modules 2>nul
echo Reinstalling...
call npm install
echo.
echo Done. Try panel option 1 again.
pause
