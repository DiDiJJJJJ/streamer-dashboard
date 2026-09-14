@echo off
REM ============================================
REM   首次部署：初始化 git 仓库、提交全部源码、推送到 GitHub
REM   运行前：先在 GitHub 网页新建一个空仓库（不要勾选 README）
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
echo   初始化 git 仓库并首次推送到 GitHub
echo ============================================
echo.
set /p REPO_URL=请输入 GitHub 仓库地址（如 https://github.com/owner/repo.git）:
if "%REPO_URL%"=="" (
  echo [错误] 未输入仓库地址
  pause
  exit /b 1
)

"%GIT%" init
"%GIT%" branch -M main
"%GIT%" add .
if errorlevel 1 (
  echo [错误] git add 失败
  pause
  exit /b 1
)

"%GIT%" commit -m "init: 线下主播看板 静态站"
if errorlevel 1 (
  echo [错误] 提交失败
  pause
  exit /b 1
)

"%GIT%" remote add origin %REPO_URL%
"%GIT%" push -u origin main
if errorlevel 1 (
  echo [错误] 推送失败：检查仓库地址 / 网络 / 是否有 write 权限
  pause
  exit /b 1
)

echo.
echo [OK] 已推送。请到仓库 Settings 配置 STATIC_PASSWORD secret 并启用 Pages（GitHub Actions）。
echo      约 1-2 分钟后访问 https://github.com/owner/repo/
pause
exit /b 0
