@echo off
title 主播管理后台 · 手动启动外网隧道（诊断窗口）
setlocal
chcp 65001 >nul

set "CF=E:\WorkBuddy\线下主播管理后台\streamer-dashboard\server\bin\cloudflared.exe"
set "TLOG=E:\WorkBuddy\线下主播管理后台\streamer-dashboard\server\tunnel.log"

echo ============================================================
echo   手动启动 Cloudflare 临时隧道（诊断窗口）
echo   本窗口会实时显示 cloudflared 日志，请勿关闭
echo ============================================================
echo.

echo [1/3] 结束旧 cloudflared 进程...
taskkill /f /im cloudflared.exe >nul 2>&1 && echo     已结束旧进程 || echo     未发现旧进程
echo.

echo [2/3] 清空旧隧道日志...
if exist "%TLOG%" del /f /q "%TLOG%"
echo     已清空
echo.

echo [3/3] 启动隧道（HTTP/2 + IPv4，日志实时输出）...
echo     若长时间未出现 "Your quick tunnel" 或 HTTPS 地址，说明当前网络到 Cloudflare 被限制。
echo     此时请换手机热点再试，或改用 Cloudflare 命名隧道。
echo.

"%CF%" tunnel --url http://localhost:8787 --logfile "%TLOG%" --loglevel info --edge-ip-version 4 --protocol http2 --no-autoupdate

echo.
echo [cloudflared 已退出，退出码: %errorlevel%]
echo 按任意键关闭本窗口...
pause >nul
