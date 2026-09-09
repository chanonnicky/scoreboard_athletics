@echo off
REM One-time setup: reserve the port + open the firewall for other machines.
REM Double-click this file and click "Yes" at the Administrator prompt.
REM (Thai deployment guide: see README.md)
setlocal
chcp 65001 >nul

set PORT=%1
if "%PORT%"=="" set PORT=8080

REM Request Administrator rights
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo   Requesting Administrator rights ...
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0' -ArgumentList '%PORT%'"
  exit /b
)

echo.
echo   Configuring port %PORT% ...
netsh http add urlacl url=http://+:%PORT%/ user=Everyone >nul 2>&1
if errorlevel 1 (echo   port %PORT% reservation already exists - OK) else (echo   port %PORT% reserved.)
netsh advfirewall firewall delete rule name="CG Live %PORT%" >nul 2>nul
netsh advfirewall firewall add rule name="CG Live %PORT%" dir=in action=allow protocol=TCP localport=%PORT% >nul
echo   firewall rule "CG Live %PORT%" set.

REM RTMP relay: open port 1935 so the venue OBS can push a stream in.
REM (API 9997 is localhost-only; outbound to the broadcast room needs no rule.)
echo   Configuring RTMP port 1935 ...
netsh advfirewall firewall delete rule name="CG Live RTMP 1935" >nul 2>nul
netsh advfirewall firewall add rule name="CG Live RTMP 1935" dir=in action=allow protocol=TCP localport=1935 >nul
echo   firewall rule "CG Live RTMP 1935" set.

echo.
echo   Done - from now on just run start.bat (no Administrator needed).
echo.
echo   For the RTMP relay:  powershell -ExecutionPolicy Bypass -File get-relay.ps1
echo   then edit mediamtx.yml (publish password + broadcast-room URL) before the event.
echo.
pause
