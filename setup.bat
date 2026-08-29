@echo off
REM ตั้งค่าครั้งเดียว: อนุญาตให้เปิดพอร์ต + เปิด firewall ให้เครื่องอื่นเข้าถึง
REM ดับเบิลคลิกไฟล์นี้ แล้วกด "Yes" ตอนถามสิทธิ์ Administrator
setlocal
chcp 65001 >nul

set PORT=%1
if "%PORT%"=="" set PORT=8080

REM ขอสิทธิ์ Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo   กำลังขอสิทธิ์ Administrator ...
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0' -ArgumentList '%PORT%'"
  exit /b
)

echo.
echo   ตั้งค่าพอร์ต %PORT% ...
netsh http add urlacl url=http://+:%PORT%/ user=Everyone
netsh advfirewall firewall add rule name="CG Live %PORT%" dir=in action=allow protocol=TCP localport=%PORT%
echo.
echo   เสร็จแล้ว — จากนี้เปิดด้วย start.bat ได้เลย (ไม่ต้องใช้ Administrator อีก)
echo.
pause
