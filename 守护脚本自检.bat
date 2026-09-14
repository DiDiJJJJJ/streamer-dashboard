@echo off
title 守护脚本自检
cd /d "%~dp0"

echo ============================================================
echo   _service_guard.vbs 自检（只检查环境，不会启动服务）
echo ============================================================
echo.

cscript //nologo "%~dp0_service_guard.vbs" /selftest

echo.
echo   退出码 = %errorlevel%
echo   看到 SELFTEST OK 即表示脚本语法与路径均正常。
echo.
pause
