@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY (where python >nul 2>nul && set "PY=python")
if not defined PY (if exist "C:\ProgramData\miniconda3\python.exe" set "PY=C:\ProgramData\miniconda3\python.exe")
if not defined PY (if exist "%USERPROFILE%\miniconda3\python.exe" set "PY=%USERPROFILE%\miniconda3\python.exe")
if not defined PY (if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python313\python.exe")

if not defined PY (
  echo.
  echo   ไม่พบ Python บนเครื่องนี้
  echo   ติดตั้ง Python 3 ก่อน: https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

echo   ใช้ Python: %PY%
echo.
"%PY%" server.py %*
echo.
pause
