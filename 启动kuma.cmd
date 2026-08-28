@echo off
setlocal
title kuma Launcher
cd /d "%~dp0"

if not exist "package.json" goto wrong_folder

where node.exe >nul 2>nul
if errorlevel 1 goto missing_node

where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_npm

if not exist "node_modules\.bin\electron.cmd" (
  echo [kuma] Installing dependencies for the first launch...
  call npm.cmd install
  if errorlevel 1 goto launch_failed
)

echo [kuma] Starting...
call npm.cmd run start
if errorlevel 1 goto launch_failed
exit /b 0

:wrong_folder
echo [kuma] package.json was not found beside this launcher.
goto pause_failed

:missing_node
echo [kuma] Node.js is not installed or is missing from PATH.
echo [kuma] Install the current Node.js LTS release, then run this launcher again.
goto pause_failed

:missing_npm
echo [kuma] npm.cmd is not available in PATH.
echo [kuma] Repair the Node.js installation, then run this launcher again.
goto pause_failed

:launch_failed
echo.
echo [kuma] Startup failed. Review the error above.

:pause_failed
echo.
pause
exit /b 1
