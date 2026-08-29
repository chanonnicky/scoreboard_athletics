@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo   กำลังเริ่ม CG Live (PowerShell) ...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*

echo.
pause
