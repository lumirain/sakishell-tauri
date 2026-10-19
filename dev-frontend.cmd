@echo off
REM ============================================
REM  SakiShell - Frontend Only Preview
REM  仅启动前端预览 (不编译 Rust, 在浏览器中查看)
REM ============================================

title SakiShell - Frontend Preview

set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
cd /d "%~dp0"

echo.
echo  ==========================================
echo    SakiShell - Frontend Preview
echo  ==========================================
echo.
echo  Starting Vite dev server...
echo  Open http://localhost:1420 in your browser.
echo.
echo  NOTE: This is UI-only mode.
echo  SSH connections and Agent features require full Tauri mode.
echo  Use dev.cmd for the complete application.
echo.
echo  Press Ctrl+C to stop.
echo.

node "./node_modules/vite/bin/vite.js"

pause
