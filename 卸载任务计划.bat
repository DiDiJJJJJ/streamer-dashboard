@echo off
title 主播管理后台 - 卸载任务计划
cd /d "%~dp0"

echo ============================================================
echo   卸载任务计划 StreamerDashboardGuard
echo   会同时停止守护进程与 Node 服务
echo ============================================================
echo.
echo   若提示 ERROR: not elevated，请右键本文件，
echo   选择「以管理员身份运行」。
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_task_unregister.ps1"

echo.
echo   结果日志：%CD%\_task_unregister.log
echo.
pause
