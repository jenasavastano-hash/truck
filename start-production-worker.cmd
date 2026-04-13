@echo off
cd /d "%~dp0signer-client"
set USE_EPL_PRODUCTION_WORKER=1
node run-workers-with-pid.js
