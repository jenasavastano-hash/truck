@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Removing large DB backup files from last commit (they stay on disk, only untracked for Git^)...
git rm --cached --ignore-unmatch backend/database.db.corrupt.bak
git rm --cached --ignore-unmatch backend/app.db.restored
git rm --cached --ignore-unmatch backend/app.db.corrupt.bak

git add .gitignore
git commit --amend -m "Initial commit: truck EPL project (no large DB dumps)"

git branch -M main

echo.
echo Pushing to GitHub...
git push -u origin main

if errorlevel 1 (
  echo If the remote already has commits, try: git pull --rebase origin main
  pause
  exit /b 1
)
echo Done.
pause
