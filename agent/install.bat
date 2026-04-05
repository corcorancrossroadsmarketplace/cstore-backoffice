@echo off
:: ============================================================
:: C-Store Back Office Agent — Installer
:: Run this as Administrator on the back office PC
:: ============================================================
title C-Store Back Office Agent Installer
color 0A

echo.
echo  ============================================================
echo    C-Store Back Office Agent Installer
echo  ============================================================
echo.
echo  This will take about 2 minutes. Do not close this window.
echo.

:: ── Step 1: Check Python ────────────────────────────────────
echo  [1/5] Checking for Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  Python is not installed. Installing now...
    echo  Downloading Python installer...
    curl -o "%TEMP%\python_installer.exe" "https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe" --silent
    echo  Running Python installer...
    "%TEMP%\python_installer.exe" /quiet InstallAllUsers=1 PrependPath=1
    echo  Python installed.
)
echo  [1/5] Python - OK

:: ── Step 2: Install packages ────────────────────────────────
echo  [2/5] Installing required packages...
pip install requests urllib3 --quiet
echo  [2/5] Packages - OK

:: ── Step 3: Configure Network Route ────────────────────────
echo  [3/5] Setting up network route to Commander...
echo.
echo  This tells Windows how to find your Verifone Commander.
echo.
route -p add 192.168.31.11 mask 255.255.255.255 10.96.10.1 >nul 2>&1
if %errorlevel% equ 0 (
    echo  [3/5] Network route - OK
) else (
    echo  [3/5] Network route - already set or not needed, continuing...
)

:: ── Step 4: Install agent files ─────────────────────────────
echo  [4/5] Installing agent...
set AGENT_DIR=%LOCALAPPDATA%\CStoreBackOffice
if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"
copy /Y "%~dp0agent.py" "%AGENT_DIR%\agent.py" >nul
echo  [4/5] Agent installed to %AGENT_DIR%

:: ── Step 5: Set up auto-start ────────────────────────────────
echo  [5/5] Setting up auto-start...
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

:: Silent launcher (no visible window when Windows starts)
(
echo Set objShell = CreateObject^("WScript.Shell"^)
echo objShell.Run "pythonw ""%AGENT_DIR%\agent.py""", 0, False
) > "%STARTUP%\CStoreAgent.vbs"

:: Desktop shortcut to view logs
(
echo Set objShell = CreateObject^("WScript.Shell"^)
echo objShell.Run "notepad ""%AGENT_DIR%\agent.log""", 1, False
) > "%USERPROFILE%\Desktop\C-Store Agent Log.vbs"

echo  [5/5] Auto-start - OK
echo.
echo  ============================================================
echo    Installation Complete!
echo  ============================================================
echo.
echo  LAST STEP: We need to set up your store connection.
echo  A window will open now asking you 4 quick questions.
echo  Have these ready:
echo.
echo    1. Your dashboard URL  (e.g. https://yourapp.vercel.app)
echo    2. Your store API key  (from your dashboard)
echo    3. Commander username  (press Enter for default: CSPPOS)
echo    4. Commander password  (press Enter for default: Welcome1234)
echo.
echo  Press any key to continue to setup...
pause >nul

:: Run first-time setup
python "%AGENT_DIR%\agent.py"

echo.
echo  Done! The agent will now start automatically every time
echo  this computer turns on.
echo.
echo  To check on it, use the "C-Store Agent Log" shortcut on your Desktop.
echo.
pause
