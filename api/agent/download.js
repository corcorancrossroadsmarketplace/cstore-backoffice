// api/agent/download.js
// GET /api/agent/download
// Serves the agent installer .bat file as a download
// No auth required - installer is not sensitive

import { setCors } from '../_lib/db.js'
import { readFileSync } from 'fs'
import { join } from 'path'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()


  // The install.bat content — served as a download
  // This is the exact same install.bat from the agent folder,
  // embedded here so managers can download it directly from the dashboard
  const batContent = `@echo off
:: ============================================================
:: C-Store Back Office Agent Installer
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

echo  [1/5] Checking for Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  Python not found. Downloading and installing Python...
    curl -o "%TEMP%\\python_installer.exe" "https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe" --silent --progress-bar
    "%TEMP%\\python_installer.exe" /quiet InstallAllUsers=1 PrependPath=1
    del "%TEMP%\\python_installer.exe"
    echo  Python installed.
)
echo  [1/5] Python - OK

echo  [2/5] Installing required packages...
pip install requests urllib3 --quiet --no-warn-script-location
echo  [2/5] Packages - OK

echo  [3/5] Configuring network route to Commander...
route -p add 192.168.31.11 mask 255.255.255.255 10.96.10.1 >nul 2>&1
echo  [3/5] Network route - OK

echo  [4/5] Installing agent...
set AGENT_DIR=%LOCALAPPDATA%\\CStoreBackOffice
if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"

:: Download the agent.py from the dashboard
curl -o "%AGENT_DIR%\\agent.py" "${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'YOUR_DASHBOARD_URL'}/api/agent/script" --silent
echo  [4/5] Agent installed.

echo  [5/5] Setting up auto-start on Windows login...
set STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup

(
echo Set objShell = CreateObject^("WScript.Shell"^)
echo objShell.Run "pythonw ""%AGENT_DIR%\\agent.py""", 0, False
) > "%STARTUP%\\CStoreAgent.vbs"

(
echo Set objShell = CreateObject^("WScript.Shell"^)
echo objShell.Run "notepad ""%AGENT_DIR%\\agent.log""", 1, False
) > "%USERPROFILE%\\Desktop\\C-Store Agent Log.vbs"

echo  [5/5] Auto-start configured.
echo.
echo  ============================================================
echo    Almost done! Just need your store details.
echo  ============================================================
echo.
echo  Please have ready:
echo    - Your dashboard URL
echo    - Your store API key (owner provides this)
echo.
echo  Press any key to enter your store details...
pause >nul

python "%AGENT_DIR%\\agent.py"

echo.
echo  ============================================================
echo    Done! This store is now connected to your dashboard.
echo  ============================================================
echo.
echo  The agent runs automatically every time Windows starts.
echo  Check the "C-Store Agent Log" shortcut on the Desktop
echo  if you ever need to troubleshoot.
echo.
pause
`

  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Disposition', 'attachment; filename="CStore-Agent-Install.bat"')
  res.status(200).send(batContent)
}
