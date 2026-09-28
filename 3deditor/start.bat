@echo off
title 3D GLB Studio - Restart Server
echo =======================================================
echo   3D GLB Studio - Restarting Server...
echo =======================================================

:: Kill any prior server process listening on port 8080
for /f "tokens=5" %%a in ('netstat -aon -p tcp 2^>nul ^| findstr :8080 ^| findstr LISTENING') do (
    if not "%%a"=="0" (
        echo [*] Stopping previous server instance (PID %%a)...
        taskkill /F /PID %%a >nul 2>&1
    )
)

:: Brief pause to ensure the socket is freed
timeout /t 1 /nobreak >nul

:: Launch fresh server instance
python serve.py
if errorlevel 1 (
    echo.
    echo Python was not found in PATH or encountered an error.
    echo Attempting py launcher...
    py serve.py
)
pause
