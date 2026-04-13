@echo off
chcp 65001 >nul
echo [Frontend] Установка зависимостей для красивого интерфейса...
echo.
cd /d "%~dp0"
npm install framer-motion lucide-react
echo.
echo [Frontend] ✓ Зависимости установлены!
echo [Frontend] Теперь можно запустить: npm run dev
pause
