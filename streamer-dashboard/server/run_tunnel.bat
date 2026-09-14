@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "CF=bin\cloudflared.exe"
if not exist "%CF%" (
  echo [隧道] 未找到 bin\cloudflared.exe，请先下载 cloudflared
  goto :eof
)

REM 检测 cloudflared 进程是否已在运行
tasklist 2>nul | findstr /i "cloudflared.exe" >nul
if not errorlevel 1 (
  echo [隧道] cloudflared 已在运行，跳过
  goto :eof
)

echo [隧道] 正在后台启动临时隧道（输出写入 tunnel.log）...
start "" /min "%CF%" tunnel --url http://localhost:8787 --logfile tunnel.log --loglevel info
echo [隧道] 已启动，公网地址见 tunnel.log
