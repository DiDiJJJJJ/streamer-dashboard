@echo off
title 重启守护服务（任务计划方式）
cd /d "%~dp0"

echo ============================================================
echo   清掉旧守护进程，并通过任务计划重新拉起服务
echo ============================================================
echo.

echo [1/4] 结束旧守护进程 wscript.exe ...
taskkill /F /IM wscript.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] 结束占用 8787 端口的残留进程 ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8787 ^| findstr LISTENING') do (
  echo       kill PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

tasklist /fi "imagename eq node.exe" 2>nul | findstr /i "node.exe" >nul 2>&1
if not errorlevel 1 (
  echo       结束残留 node.exe ...
  taskkill /F /IM node.exe /T >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo [3/4] 触发任务计划 StreamerDashboardGuard ...
schtasks /run /tn "StreamerDashboardGuard"
if errorlevel 1 (
  echo.
  echo       [失败] 无法启动任务。请右键本文件 -^> 以管理员身份运行，
  echo       或先双击「注册任务计划.bat」重新注册。
  goto end
)

echo [4/4] 等待 8787 端口就绪（最多 60 秒）...
set tries=0
:wait
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto ok
set /a tries+=1
if %tries% geq 60 (
  echo       [警告] 60 秒内端口仍未就绪
  echo       请查看 streamer-dashboard\server\server_run.log
  goto end
)
timeout /t 1 /nobreak >nul
goto wait

:ok
echo.
echo       服务已就绪： http://localhost:8787

:end
echo.
pause
