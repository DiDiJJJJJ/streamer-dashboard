@echo off
title 主播管理后台 - 注册任务计划
cd /d "%~dp0"

echo ============================================================
echo   把 _service_guard.vbs 注册为 Windows 任务计划
echo   触发器：用户登录后 30 秒自动启动，全程无窗口
echo ============================================================
echo.
echo   若提示 ERROR: not elevated，请右键本文件，
echo   选择「以管理员身份运行」。
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_task_register.ps1"

echo.
echo   结果日志：%CD%\_task_register.log
echo   服务地址：http://localhost:8787
echo.
pause
