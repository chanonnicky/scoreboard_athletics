@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

REM  เริ่ม CG Live บน Windows (server.ps1 — ไม่ต้องมี Python)
REM  วิธีใช้:  start.bat                        (พอร์ต 8080)
REM           start.bat --port 9000             (กำหนดพอร์ตเอง — แบบเดียวกับ start.sh)
REM           start.bat --host localhost --token SECRET
REM  ทุก argument ส่งต่อให้ server.ps1 ซึ่งรับทั้ง --port/--host/--token และ -Port/-ListenHost/-Token

echo   กำลังเริ่ม CG Live ...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*

echo.
pause
