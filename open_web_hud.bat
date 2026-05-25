@echo off
echo Waiting for ONYX dashboard at http://127.0.0.1:5173/
echo.
for /l %%i in (1,1,30) do (
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/ -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
    if not errorlevel 1 (
        echo Dashboard is ready.
        start "" "http://127.0.0.1:5173/"
        exit /b 0
    )
    timeout /t 1 /nobreak >nul
)
echo Dashboard did not start yet.
echo Run start_web_hud.bat and keep that window open, then try this file again.
pause
