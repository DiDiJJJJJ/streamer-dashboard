@echo off
chcp 65001 >nul
set "DIR=E:\WorkBuddy\线下主播管理后台\streamer-dashboard"
echo ============================================
echo  重启主播管理后台服务（杀旧进程 + 启动新实例）
echo ============================================
echo.
echo [1/3] 结束占用 8787 端口的旧服务进程...
powershell -NoProfile -Command "$p=Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if($p){ $p | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Write-Host '  已结束进程 PID: ' $p } else { Write-Host '  未发现 8787 端口占用' }"
timeout /t 2 /nobreak >nul
echo.
echo [2/3] 确认端口已释放...
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue; if($c){ Write-Host '  警告：8787 仍被占用，请手动在任务管理器结束 node.exe' } else { Write-Host '  端口 8787 已空闲' }"
timeout /t 1 /nobreak >nul
echo.
echo [3/3] 启动服务（守护循环，崩溃自动重启）...
start "" "%DIR%\启动主播管理后台服务-自动重启.bat"
echo.
echo 完成。新服务将加载最新后端代码（含波动主播清单接口）。
echo 浏览器请按 Ctrl+Shift+R 强刷「运营月度统计」页。
echo 按任意键关闭本窗口...
pause >nul
