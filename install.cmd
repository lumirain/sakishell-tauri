@echo off
REM ============================================
REM  SakiShell - Install Dependencies
REM  安装前端依赖
REM ============================================

title SakiShell - Install

set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
cd /d "%~dp0"

echo.
echo  Installing dependencies...
echo.

where pnpm >nul 2>nul
if %ERRORLEVEL% equ 0 (
    pnpm install
) else (
    echo  pnpm not found, using npm to install pnpm first...
    call npm install -g pnpm
    pnpm install
)

echo.
echo  Done! Run dev.cmd to start the application.
echo.
pause
