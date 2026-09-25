@echo off
title Pehchaan SIH 2026 - Full Stack Launcher
color 0B

echo.
echo ============================================================
echo   Pehchaan - AI-Based Fake Identity ^& Document Screening
echo   Smart India Hackathon 2026 - Problem Statement 26188
echo ============================================================
echo.

REM Get the directory where this script is located
set "ROOT_DIR=%~dp0"
set "FRONTEND_DIR=%ROOT_DIR%frontend"
set "BACKEND_DIR=%ROOT_DIR%backend"

REM ---- Preflight checks ----
echo [PREFLIGHT] Checking prerequisites...

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found on PATH. Install Python 3.11+ first.
    pause
    exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found on PATH. Install Node.js 18+ first.
    pause
    exit /b 1
)

echo   Python: OK
echo   Node:   OK
echo.

REM ---- Kill stale processes on ports 3000 and 8000 ----
echo [CLEANUP] Freeing ports 3000 and 8000...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo   Killing PID %%a on port 3000
    taskkill /F /PID %%a >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    echo   Killing PID %%a on port 8000
    taskkill /F /PID %%a >nul 2>&1
)

echo   Ports clear.
echo.

REM ---- Backend setup ----
echo [1/4] Checking backend virtual environment...

if not exist "%BACKEND_DIR%\.venv\Scripts\activate.bat" (
    echo   Creating venv...
    where py >nul 2>&1
    if %errorlevel% equ 0 (
        py -3.11 -m venv "%BACKEND_DIR%\.venv" 2>nul
        if %errorlevel% neq 0 python -m venv "%BACKEND_DIR%\.venv"
    ) else (
        python -m venv "%BACKEND_DIR%\.venv"
    )
    if not exist "%BACKEND_DIR%\.venv\Scripts\activate.bat" (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo   venv created.
) else (
    echo   venv found.
)

echo [2/4] Installing backend dependencies...
call "%BACKEND_DIR%\.venv\Scripts\activate.bat"
pip install -q -r "%BACKEND_DIR%\requirements.txt" 2>nul
echo   Dependencies ready.
call deactivate 2>nul

REM ---- Frontend setup ----
echo [3/4] Checking frontend dependencies...

if not exist "%FRONTEND_DIR%\node_modules" (
    echo   Running npm install...
    cd /d "%FRONTEND_DIR%"
    npm install
    cd /d "%ROOT_DIR%"
) else (
    echo   node_modules found.
)

echo [4/4] Starting servers...
echo.

REM ---- Start backend in a new window ----
start "Pehchaan Backend" cmd /k "cd /d %BACKEND_DIR% && call .venv\Scripts\activate.bat && echo Backend starting on http://localhost:8000 && uvicorn app.main:app --reload --port 8000"

REM Give backend a moment to start
timeout /t 3 /nobreak >nul

REM ---- Start frontend in a new window ----
start "Pehchaan Frontend" cmd /k "cd /d %FRONTEND_DIR% && echo Frontend starting on http://localhost:3000 && npm run dev"

echo.
echo ============================================================
echo   Both servers starting in separate windows:
echo.
echo   Backend API:   http://localhost:8000
echo   Backend Docs:  http://localhost:8000/docs
echo   Frontend App:  http://localhost:3000
echo   Neon Status:   http://localhost:3000/api/neon/status
echo ============================================================
echo.
echo   Close individual terminal windows to stop each server.
echo   Press any key to close this launcher...
pause >nul
