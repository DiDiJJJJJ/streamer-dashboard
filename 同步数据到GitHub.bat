@echo off
REM ============================================
REM   源机自动同步脚本：git add . + commit + push 到 origin/main
REM   （依赖根目录 .gitignore 排除 node_modules/dist/.workbuddy 等）
REM   GitHub Actions CI 会自动重新构建 dist 并部署到 Pages
REM ============================================

set "GIT=C:\Users\Administrator\.workbuddy\binaries\PortableGit\versions\1.2.0\mingw64\bin\git.exe"
if not exist "%GIT%" (
  echo [错误] 找不到 git.exe：%GIT%
  echo        请确认已安装 Git，或手动修改本脚本顶部的 GIT 变量。
  pause
  exit /b 1
)

chcp 65001 >nul

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ============================================
echo   源机数据同步到 GitHub
echo ============================================

"%GIT%" status --short
if errorlevel 1 (
  echo [错误] 当前目录不是 git 仓库，请先运行「初始化GitHub仓库.bat」
  pause
  exit /b 1
)

echo.
set /p CONFIRM=确认提交并推送到 origin/main？(y/N):
if /i not "%CONFIRM%"=="y" goto cancel

"%GIT%" add .
"%GIT%" commit -m "chore: 同步数据与源码 %date%"
if errorlevel 1 (
  echo [sync] 无变更或提交失败，跳过推送
  goto end
)

"%GIT%" push origin main
if errorlevel 1 (
  echo [错误] 推送失败：请确认已配置 remote 且网络可访问 GitHub
  pause
  exit /b 1
)

echo.
echo [sync] 已推送，GitHub Actions 将自动重新构建并部署到 Pages
echo       访问 https://github.com/^<owner^>/^<repo^>/actions 查看进度

:end
pause
exit /b 0

:cancel
echo [sync] 已取消
pause
exit /b 0
