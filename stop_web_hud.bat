@echo off
setlocal
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":17878" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F
)
echo ONYX web HUD ports stopped.
pause
