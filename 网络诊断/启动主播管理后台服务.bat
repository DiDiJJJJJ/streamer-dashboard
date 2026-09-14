@echo off
chcp 65001 >nul 2>&1
title 主播管理后台服务

set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set "PROJECT=E:\WorkBuddy\线下主播管理后台\streamer-dashboard"

cd /d "%PROJECT%"

echo.
echo 正在启动线下主播管理后台服务...
echo 项目目录: %PROJECT%
echo Node: %NODE%
echo.
echo 如 8787 端口已被占用，请先关闭旧窗口或结束占用进程。
echo.

"%NODE%" server\index.js

pause
