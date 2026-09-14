@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "NODE_EXE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

REM 检测 8787 是否已在监听，避免重复启动导致 EADDRINUSE
netstat -ano 2>nul | findstr ":8787" >nul
if not errorlevel 1 (
  echo [数据服务] 8787 已在运行，跳过
  goto :eof
)

echo [数据服务] 正在后台启动...
start "" /min "%NODE_EXE%" index.js
echo [数据服务] 已启动，访问 http://localhost:8787
