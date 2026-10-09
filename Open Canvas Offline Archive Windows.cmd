@echo off
rem [Codex] Start the local Canvas archive on Windows.
setlocal
cd /d "%~dp0"
chcp 65001 >nul
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" bootstrap_windows.py %*
    if errorlevel 1 pause
    exit /b
)
py -3.14 --version >nul 2>&1
if %errorlevel%==0 (
    py -3.14 bootstrap_windows.py %*
) else (
    python --version >nul 2>&1
    if errorlevel 1 (
        echo Python 3.14 is required. Install it from python.org, then retry.
        pause
        exit /b 1
    )
    python bootstrap_windows.py %*
)
if errorlevel 1 pause
