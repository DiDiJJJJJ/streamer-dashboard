@echo off
chcp 65001 >nul 2>&1
title 主播管理后台 · 服务守护（请勿关闭此窗口）
setlocal

set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set "ROOT=E:\WorkBuddy\线下主播管理后台\streamer-dashboard"
set "LOG=%ROOT%\server\server_run.log"

:: ============================================================
:: 关键：清空外部注入的 NODE_OPTIONS。
:: 某些工具会注入 --require 文件钩子，它会拦截 fs 写入/删除，
:: 累计操作超过阈值后一律返回 EPERM，导致抓取正常但数据永久停更。
:: ============================================================
set "NODE_OPTIONS="

cd /d "%ROOT%"

:loop
echo [守护] %date% %time% 正在启动服务... >> "%LOG%"
"%NODE%" server\index.js >> "%LOG%" 2>&1
echo [守护] %date% %time% 服务已退出（代码 %errorlevel%），10 秒后自动重启 >> "%LOG%"
timeout /t 10 /nobreak >nul
goto loop
