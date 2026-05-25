@echo off
cd /d "%~dp0"
echo ==========================================
echo  ONYX Drive HUD Web Dashboard
echo ==========================================
echo.
echo Starting Forza UDP listener on port 1234...
echo Starting dashboard website...
echo.
echo When it is ready, open:
echo http://127.0.0.1:5173/
echo.
echo Keep this window open while using the HUD.
echo Press Ctrl+C to stop.
echo.
npm.cmd run dev
pause
