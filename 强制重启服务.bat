@echo off
title 主播管理后台 · 强制重启（清理残留进程后启动）
setlocal EnableExtensions
chcp 65001 >nul

set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set "ROOT=E:\WorkBuddy\线下主播管理后台\streamer-dashboard"
set "GUARD=%~dp0_service_guard.vbs"
set "TLOG=%ROOT%\server\tunnel.log"

echo ============================================================
echo   主播管理后台 · 强制重启
echo   作用：杀掉占用 8787 的残留进程与旧守护，重新拉起服务
echo ============================================================
echo.

echo [1/4] 关闭占用 8787 端口的残留进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1 && echo     已结束残留进程 PID=%%a
)
echo     端口占用清理完成。
echo.

echo [2/4] 关闭旧的守护脚本与隧道进程...
taskkill /f /im wscript.exe >nul 2>&1 && echo     已结束 wscript 进程 || echo     未发现 wscript 进程
taskkill /f /im cloudflared.exe >nul 2>&1 && echo     已结束 cloudflared 进程 || echo     未发现 cloudflared 进程
echo.

echo [3/4] 等待 2 秒让端口释放...
timeout /t 2 /nobreak >nul
echo.

echo [4/4] 重新启动服务守护（崩溃 5 秒自动重启）...
if not exist "%GUARD%" (
    echo     [错误] 找不到守护脚本：%GUARD%
    goto end
)
start "" wscript.exe "%GUARD%"
echo     服务守护已在后台启动，正在等待端口就绪（最多 60 秒）...
set "tries=0"
:wait_svc
netstat -ano ^| findstr ":8787" ^| findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto svc_ok
set /a tries+=1
if %tries% geq 60 (
    echo     [警告] 60 秒内端口仍未就绪，请检查：
    echo       %ROOT%\server\server_run.log
    goto show_url
)
timeout /t 1 /nobreak >nul
goto wait_svc
:svc_ok
echo     本地服务已就绪：http://localhost:8787
echo.

:show_url
echo ============================================================
echo   访问地址
echo   本地：http://localhost:8787
echo ============================================================
echo.
echo   服务以无窗口后台运行，关闭本窗口不会断开。
echo   外网地址若需查看，请打开：
echo     %TLOG%
echo   （搜索 trycloudflare.com，最新一行即当前公网地址）
echo.

:end
pause
