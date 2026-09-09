@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

REM  เริ่ม CG Live บน Windows (server.ps1 — ไม่ต้องมี Python)
REM  วิธีใช้:  start.bat                        (พอร์ต 8080)
REM           start.bat --port 9000             (กำหนดพอร์ตเอง — แบบเดียวกับ start.sh)
REM           start.bat --host localhost --token SECRET
REM  ทุก argument ส่งต่อให้ server.ps1 ซึ่งรับทั้ง --port/--host/--token และ -Port/-ListenHost/-Token

REM  --- RTMP relay (ทางเลือก) -------------------------------------------------
REM  ถ้ามี bin\mediamtx\mediamtx.exe (ได้จาก get-relay.ps1) จะเปิด relay ให้ด้วย
REM  ในหน้าต่างแยก — รับ RTMP จาก OBS หน้างานแล้ว push ต่อไปห้องถ่ายทอดสด
REM  ปิด relay = ปิดหน้าต่างนั้น. ไม่มีไฟล์นี้ = ข้ามไป (CG server ทำงานปกติทุกอย่าง)
if exist "%~dp0bin\mediamtx\mediamtx.exe" goto relay_on
echo   [i] ยังไม่ได้เปิด RTMP relay — ไม่พบ bin\mediamtx\mediamtx.exe
echo       ถ้าต้องการ:  powershell -ExecutionPolicy Bypass -File get-relay.ps1
goto relay_done
:relay_on
echo   กำลังเริ่ม RTMP relay MediaMTX ...
start "CG Relay (MediaMTX)" "%~dp0bin\mediamtx\mediamtx.exe" "%~dp0mediamtx.yml"
:relay_done
echo.

echo   กำลังเริ่ม CG Live ...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*

echo.
pause
