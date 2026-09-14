@echo off
chcp 65001 >nul
title 线下主播看板 - 公网隧道

:: 本脚本通过 npx localtunnel 把本地 8787 端口暴露到公网
:: 需要先运行「启动数据同步服务.bat」，让服务在 8787 端口启动

echo ============================================================
echo    线下主播看板 - 公网隧道
echo ============================================================
echo.
echo [说明] 本窗口会生成一个 https://xxxx.loca.lt 的公网链接，
echo        关闭本窗口后公网链接即失效。
echo        若首次使用看到 IP 白名单页，请按提示点击确认。
echo.

npx --yes localtunnel --port 8787

if errorlevel 1 (
  echo.
  echo [错误] 隧道启动失败，请检查网络或 Node/npm 是否可用
  echo.
)

pause
