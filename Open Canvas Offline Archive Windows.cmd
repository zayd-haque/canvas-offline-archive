@echo off
goto launch                                           
setlocal
cd /d "%~dp0"
chcp 65001 >nul
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
exit /b

:launch
rem Parse the whole launch block before an update can replace this file.
(
setlocal
cd /d "%~dp0"
chcp 65001 >nul
rem [Codex] One-click private Python setup for tidy downloads and source checkouts.
if exist "App Files\bootstrap_windows.ps1" (
    "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "App Files\bootstrap_windows.ps1" %*
    if errorlevel 1 (
        pause
        exit /b 1
    )
    exit /b 0
)
if exist "bootstrap_windows.ps1" (
    "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "bootstrap_windows.ps1" %*
    if errorlevel 1 (
        pause
        exit /b 1
    )
    exit /b 0
)
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" bootstrap_windows.py %*
    if errorlevel 1 pause
    exit /b
)
py -3.14 --version >nul 2>&1
if not errorlevel 1 (
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
)
