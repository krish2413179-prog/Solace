@echo off
setlocal enabledelayedexpansion

set WORKER_COUNT=50
set KEYSTORE_PASSWORD=password123
set TIMESTAMP=%TIME::=-%
set TIMESTAMP=%TIMESTAMP: =0%

for /L %%i in (1,1,%WORKER_COUNT%) do (
    set "KEYSTORE_PATH=./keystores/worker%%i.json"
    set "WORKER_ID=%%i"
    echo [Launcher] Starting Worker %%i...
    start /B npx tsx src/worker.ts > logs/worker%%i_!TIMESTAMP!.log 2>&1
    ping 127.0.0.1 -n 1 > nul
)

echo.
echo ✅ ALL 50 WORKERS LAUNCHED WITH UNIQUE LOGS.
