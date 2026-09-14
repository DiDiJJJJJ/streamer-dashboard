@echo off
chcp 65001 >nul 2>&1
title 主播管理后台（本地服务 + 外网隧道）
setlocal

set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set "ROOT=E:\WorkBuddy\线下主播管理后台\streamer-dashboard"
set "CF=%ROOT%\server\bin\cloudflared.exe"
set "LOG=%ROOT%\server\tunnel.log"

echo ============================================================
echo   主播管理后台 · 一键启动（服务 + 外网隧道）
echo ============================================================
echo.

echo [1/2] 正在启动本地服务 (localhost:8787)...
start /min "" "%NODE%" "%ROOT%\server\index.js"
echo       本地服务窗口已最小化，请勿关闭。
timeout /t 5 /nobreak >nul

echo.
echo [2/2] 正在启动外网隧道...
echo       清理可能冲突的旧 cloudflared 进程...
taskkill /f /im cloudflared.exe >nul 2>&1 && echo       已结束旧 cloudflared 进程 || echo       未发现旧 cloudflared 进程
timeout /t 2 /nobreak >nul
if not exist "%CF%" (
  echo       [错误] 未找到 cloudflared：%CF%
  goto :end
)
:: 清空旧日志，便于读取新地址
>"%LOG%" (
  echo.
)
start /min "" "%CF%" tunnel --url http://localhost:8787 --logfile "%LOG%" --loglevel info
echo       隧道窗口已最小化，请勿关闭。
echo       正在生成公网地址（约 10 秒）...
timeout /t 12 /nobreak >nul

echo.
echo ============================================================
echo   外网地址（定时刷新，取最新一条）：
echo ============================================================
powershell -NoProfile -Command "Get-Content '%LOG%' | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1 | ForEach-Object { $_.Matches.Value }"

echo.
echo   说明：服务窗口与隧道窗口都不要关闭，否则网站会断开。
echo   临时隧道地址每次启动都会变化；如需固定域名请改用 Cloudflare 命名隧道。
echo.
:end
pause
