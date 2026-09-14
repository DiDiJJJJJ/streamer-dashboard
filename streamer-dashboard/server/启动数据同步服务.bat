@echo off
chcp 65001 >nul
title 线下主播看板 - 数据自动同步服务
cd /d "%~dp0"

set "NODE_DIR=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CLI=%NODE_DIR%\node_modules\npm\bin\npm-cli.js"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo ============================================================
echo    线下主播看板 - 数据自动同步服务
echo ============================================================
echo.

if not exist "node_modules" goto INSTALL
goto RUN

:INSTALL
echo [1/2] 首次运行，正在安装依赖，请稍候（约 1 分钟）...
"%NODE_EXE%" "%NPM_CLI%" install --registry=https://registry.npmmirror.com
if errorlevel 1 goto FAIL
echo [1/2] 依赖安装完成
echo.

:RUN
echo [2/2] 正在启动同步服务...
echo    服务地址: http://localhost:8787
echo    今日数据: 每 20 分钟自动抓取
echo    昨日数据: 每日 12:30 自动抓取
echo    首次使用请在页面「数据自动同步」中点击【扫码登录B站】
echo.
echo    关闭本窗口即停止服务，请保持窗口开启
echo ============================================================
echo.
start "" http://localhost:8787
"%NODE_EXE%" index.js
goto END

:FAIL
echo.
echo [错误] 依赖安装失败，请检查网络后重试
echo.

:END
pause
