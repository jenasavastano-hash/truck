@echo off
setlocal enabledelayedexpansion

REM Cleanup script for this repo (Windows).
REM Safe to run multiple times.

pushd "%~dp0"

echo.
echo === Cleaning build artifacts and dependencies ===

REM Frontend
if exist "frontend\dist" (
  echo Removing frontend\dist
  rmdir /s /q "frontend\dist"
)
if exist "frontend\node_modules" (
  echo Removing frontend\node_modules
  rmdir /s /q "frontend\node_modules"
)

REM Backend
if exist "backend\node_modules" (
  echo Removing backend\node_modules
  rmdir /s /q "backend\node_modules"
)

REM Deploy tooling (optional)
if exist "deploy\node_modules" (
  echo Removing deploy\node_modules
  rmdir /s /q "deploy\node_modules"
)

REM E2E tooling (optional)
if exist "e2e\node_modules" (
  echo Removing e2e\node_modules
  rmdir /s /q "e2e\node_modules"
)
if exist "e2e\playwright-report" (
  echo Removing e2e\playwright-report
  rmdir /s /q "e2e\playwright-report"
)

REM Signer client local state (optional, heavy)
if exist "signer-client\profiles" (
  echo Removing signer-client\profiles
  rmdir /s /q "signer-client\profiles"
)
if exist "signer-client\logs" (
  echo Removing signer-client\logs
  rmdir /s /q "signer-client\logs"
)

REM Common artifacts
if exist "npm-debug.log" del /q "npm-debug.log"
if exist "yarn-error.log" del /q "yarn-error.log"

echo.
echo Done.
echo Next: run "npm install" in backend and frontend.

popd
endlocal
