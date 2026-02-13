@echo off
title HaloView Launcher
echo ========================================
echo   HaloView - Starting all services...
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Starting signaling server...
start "HaloView Signal" cmd /k "cd /d "%~dp0" && node src/signaling/server.js"
timeout /t 2 /nobreak >nul

echo [2/3] Starting Vite dev server...
start "HaloView Vite" cmd /k "cd /d "%~dp0" && npx vite --host"
timeout /t 2 /nobreak >nul

echo [3/3] Starting Electron capture app...
start "HaloView Capture" cmd /k "cd /d "%~dp0electron" && npx electron ."

echo.
echo ========================================
echo   All services started!
echo   Open Quest 3 browser to the URL
echo   shown in the Vite window.
echo ========================================
echo.
echo Press any key to stop all services...
pause >nul

echo Shutting down...
taskkill /fi "WINDOWTITLE eq HaloView Signal" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq HaloView Vite" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq HaloView Capture" /f >nul 2>&1
echo Done.
