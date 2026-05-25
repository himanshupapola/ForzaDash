@echo off
setlocal
cd /d "%~dp0"
call :load_env

:menu
cls
echo ==========================================
echo  ForzaDash
echo ==========================================
echo.
echo  1. Start HUD and open web dashboard
echo  2. Stop HUD and close
echo.
set /p choice=Choose option: 

if "%choice%"=="1" goto start_hud
if "%choice%"=="2" goto stop_hud

echo.
echo Invalid option.
timeout /t 1 /nobreak >nul
goto menu

:start_hud
cls
echo ==========================================
echo  Starting ForzaDash
echo ==========================================
echo.
echo Forza UDP:  127.0.0.1:%VITE_FORZA_UDP_PORT%
echo Dashboard:  http://127.0.0.1:%VITE_DASHBOARD_PORT%/
echo Telemetry:  ws://127.0.0.1:%VITE_PUBLIC_TELEMETRY_WS_PORT%/
echo.
echo Keep this command window open while using the HUD.
echo Press Ctrl+C to stop the attached server.
echo.

if not exist "node_modules\" (
  echo Installing dependencies first...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Install failed.
    pause
    exit /b 1
  )
  echo.
)

start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 40; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%VITE_DASHBOARD_PORT%/' -TimeoutSec 1; if ($r.StatusCode -eq 200) { Start-Process 'http://127.0.0.1:%VITE_DASHBOARD_PORT%/'; break } } catch {}; Start-Sleep -Seconds 1 }"
call npm.cmd run dev
exit /b %errorlevel%

:stop_hud
cls
echo Stopping ForzaDash...
echo.
powershell -NoProfile -Command "$ports = @(%VITE_FORZA_UDP_PORT%,%VITE_TELEMETRY_WS_PORT%,%VITE_DASHBOARD_PORT%,%VITE_PUBLIC_TELEMETRY_WS_PORT%); $ids = @(); foreach ($port in $ports) { $ids += Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess; $ids += Get-NetUDPEndpoint -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess }; $ids | Where-Object { $_ -and $_ -ne $PID } | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
echo ForzaDash stopped.
timeout /t 1 /nobreak >nul
exit /b 0

:load_env
set "VITE_DASHBOARD_PORT=5173"
set "VITE_FORZA_UDP_PORT=1234"
set "VITE_TELEMETRY_WS_PORT=17878"
set "VITE_PUBLIC_TELEMETRY_WS_PORT=5174"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if not "%%a"=="" set "%%a=%%b"
  )
)
exit /b 0
