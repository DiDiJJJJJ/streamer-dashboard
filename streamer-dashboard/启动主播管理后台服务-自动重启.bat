@echo off
chcp 65001 >nul
set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set "DIR=E:\WorkBuddy\线下主播管理后台\streamer-dashboard"
set "LOG=%DIR%\server\server_run.log"
:loop
echo [%date% %time%] 启动主播管理后台服务 (node server/index.js) >> "%LOG%"
"%NODE%" "%DIR%\server\index.js"
echo [%date% %time%] 服务进程已退出，5 秒后自动重启... >> "%LOG%"
timeout /t 5 /nobreak >nul
goto loop
