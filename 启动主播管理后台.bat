@echo off
title 主播管理后台 · 一键启动
setlocal

set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set "ROOT=E:\WorkBuddy\线下主播管理后台\streamer-dashboard"
set "CF=%ROOT%\server\bin\cloudflared.exe"
set "TLOG=%ROOT%\server\tunnel.log"
set "GUARD=%~dp0_service_guard.vbs"
set "CF_GUARD=%~dp0cloudflared_guard.vbs"

echo ============================================================
echo   主播管理后台 · 一键启动（本地服务 + 外网隧道）
echo ============================================================
echo.

echo [1/3] 检查本地服务状态...
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto svc_running

echo       未检测到服务，正在以后台无窗口模式启动（崩溃后自动重启）...
if not exist "%GUARD%" (
  echo       [错误] 找不到守护脚本：%GUARD%
  goto end
)
echo       启动守护脚本: %GUARD%
start "" wscript.exe "%GUARD%"
echo       服务守护已在后台启动，正在等待端口就绪（最多 60 秒）...
set tries=0
:wait_svc
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto svc_ok
set /a tries+=1
if %tries% geq 60 (
  echo       [警告] 60 秒内端口仍未就绪
  echo       请检查: %ROOT%\server\server_run.log
  echo       应看到 "[guard-vbs] ... starting service..." 字样
  goto check_tunnel
)
timeout /t 1 /nobreak >nul
goto wait_svc
:svc_ok
echo       本地服务已就绪（http://localhost:8787）。
goto check_tunnel

:svc_running
echo       服务已在运行（8787 端口正在监听），跳过启动。
echo       如需重启服务，请在任务管理器结束 wscript.exe 与 node.exe 进程后再运行本脚本。

:check_tunnel
echo.
echo [2/3] 检查外网隧道...
echo       清理可能冲突的旧 cloudflared 进程...
echo       清空旧隧道日志...
if exist "%TLOG%" del /f /q "%TLOG%"
echo       已清空旧隧道日志
taskkill /f /im cloudflared.exe >nul 2>&1 && echo       已结束旧 cloudflared 进程 || echo       未发现旧 cloudflared 进程
timeout /t 2 /nobreak >nul
echo       正在启动隧道...
if not exist "%CF%" (
  echo       [跳过] 未找到 cloudflared：%CF%
  echo       本地仍可访问：http://localhost:8787
  goto end
)

>"%TLOG%" echo.
echo       启动 Cloudflared 守护（崩溃/退出后自动重连）...
if not exist "%CF_GUARD%" (
  echo       [错误] 找不到隧道守护脚本：%CF_GUARD%
  goto end
)
start "" wscript.exe "%CF_GUARD%"
echo       隧道守护已在后台启动，正在等待公网地址生成（最多 120 秒）...
set tries=0
:wait_tunnel
powershell -NoProfile -Command "if (Select-String -Path '%TLOG%' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -Quiet) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 goto tunnel_ok
set /a tries+=1
if %tries% geq 120 (
  echo       [警告] 120 秒内未获取到公网地址。
  echo       当前网络到 Cloudflare 的连接可能受限（UDP/QUIC 或 TCP/HTTP2 均被限制，或连接极不稳定）。
  echo       建议：1) 隧道守护已启用，会自动重试，可稍等 1-2 分钟后刷新本页面；2) 若仍不行，切换网络（如手机热点）后再运行本脚本；3) 长期稳定使用请改用 Cloudflare 命名隧道获得固定域名。
  echo       日志：%TLOG%
  goto show_url
)
if %tries%==30 echo       已等待 30 秒，仍在尝试建立隧道...
if %tries%==60 echo       已等待 60 秒，仍在尝试建立隧道...
if %tries%==90 echo       已等待 90 秒，仍在尝试建立隧道...
timeout /t 1 /nobreak >nul
goto wait_tunnel
:tunnel_ok
echo       公网地址已生成。
goto show_url


:show_url
echo.
echo [3/3] 访问地址
echo ============================================================
echo   本地：http://localhost:8787
powershell -NoProfile -Command "$m = Select-String -Path '%TLOG%' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1; if ($m) { '  外网：' + $m.Matches.Value } else { '  外网：未获取到地址，请查看 ' + '%TLOG%' }"
echo ============================================================
echo.
echo   提示：
echo     1) 服务现在以「无窗口后台」运行，关闭本窗口不会让它断开。
echo     2) 临时隧道地址每次重启都会变化；需要固定域名请改用 Cloudflare 命名隧道。
echo     3) 服务日志：%ROOT%\server\server_run.log
echo.

:end
pause
