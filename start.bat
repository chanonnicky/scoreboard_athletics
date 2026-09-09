@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

REM  Start CG Live on Windows (server.ps1 - no Python needed).
REM  Usage:  start.bat                     (port 8080)
REM          start.bat --port 9000         (custom port, same as start.sh)
REM          start.bat --host localhost --token SECRET
REM  All args are forwarded to server.ps1 (--port/--host/--token and -Port/-ListenHost/-Token).
REM  (Thai deployment guide: see README.md)

REM  --- RTMP relay (optional) -----------------------------------------------
REM  If bin\mediamtx\mediamtx.exe exists (from get-relay.ps1) the RTMP relay is
REM  launched in its own window: ingest RTMP from the venue OBS and push it on
REM  to the broadcast room. Close that window to stop the relay. If the file is
REM  missing this is skipped and the CG server starts exactly as before.
if exist "%~dp0bin\mediamtx\mediamtx.exe" goto relay_on
echo   [i] RTMP relay not started - bin\mediamtx\mediamtx.exe not found
echo       To enable:  powershell -ExecutionPolicy Bypass -File get-relay.ps1
goto relay_done
:relay_on
if not exist "%~dp0mediamtx.yml" copy /y "%~dp0mediamtx.example.yml" "%~dp0mediamtx.yml" >nul
echo   Starting RTMP relay (MediaMTX) ...
start "CG Relay (MediaMTX)" "%~dp0bin\mediamtx\mediamtx.exe" "%~dp0mediamtx.yml"
:relay_done
echo.

echo   Starting CG Live ...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*

echo.
pause
