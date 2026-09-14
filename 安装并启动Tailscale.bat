@echo off
title 安装并启动 Tailscale（手机访问本地 8787 服务）
setlocal
chcp 65001 >nul

set "TS=C:\Program Files\Tailscale\tailscale.exe"
set "TMPMSI=%TEMP%\tailscale-setup.msi"

echo ============================================================
echo   Tailscale 安装与登录（用于手机访问本地 8787 服务）
echo ============================================================
echo.
echo   注意：本脚本会安装系统服务，请右键「以管理员身份运行」。
echo.

if not exist "%TS%" (
  echo [1/3] 未检测到 Tailscale，开始下载安装...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://pkgs.tailscale.com/stable/tailscale-setup-amd64.msi' -OutFile '%TMPMSI%'"
  if not exist "%TMPMSI%" (
    echo   [错误] 下载失败，请手动到 https://tailscale.com/download/windows 下载安装
    goto end
  )
  echo   正在静默安装（需要管理员权限）...
  msiexec /i "%TMPMSI%" /quiet /norestart
  timeout /t 6 /nobreak >nul
) else (
  echo [1/3] Tailscale 已安装，跳过下载。
)

echo.
echo [2/3] 启动 Tailscale 并登录...
"%TS%" up
echo   已打开浏览器，请完成 Tailscale 账号登录（Google / Microsoft / GitHub 等均可）。
echo   登录完成后本窗口会自动返回。
echo.

echo [3/3] 获取本机虚拟地址...
"%TS%" ip -4
echo.
echo   请将上方显示的 IP 地址记下来，手机访问格式为：
echo   http://^<上方IP^>:8787
echo   手机需安装 Tailscale App 并登录同一账号。
echo.

:end
pause
