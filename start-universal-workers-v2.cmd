@echo off
cd /d "%~dp0signer-client"
set USE_UNIVERSAL_V2=1
node run-workers-with-pid.js
