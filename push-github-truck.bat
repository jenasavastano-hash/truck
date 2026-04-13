@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo Git not found in PATH. Install: https://git-scm.com/download/win
  pause
  exit /b 1
)

if not exist ".git" (
  echo Initializing repository...
  git init
)

git remote remove origin 2>nul
git remote add origin "https://github.com/jenasavastano-hash/truck.git"

echo.
echo Staging files ^(respects .gitignore^)...
git add -A

git status --short
echo.

git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Initial commit: truck EPL project"
  if errorlevel 1 (
    echo Commit failed.
    pause
    exit /b 1
  )
) else (
  echo Nothing new to commit ^(working tree clean or only ignored files^).
)

git rev-parse --verify HEAD >nul 2>&1
if errorlevel 1 (
  echo No commits to push. Add files or fix .gitignore.
  pause
  exit /b 1
)

git branch -M main 2>nul

echo.
echo Pushing to GitHub...
git push -u origin main
if errorlevel 1 (
  echo.
  echo Push failed. For HTTPS use a Personal Access Token as password, or run: gh auth login
  echo Repo: https://github.com/jenasavastano-hash/truck
  pause
  exit /b 1
)

echo.
echo Done. https://github.com/jenasavastano-hash/truck
pause
