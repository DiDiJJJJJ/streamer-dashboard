@echo off
REM ============================================
REM   静态站一键构建脚本（GitHub Pages 部署用）
REM   - 导出 server/data → public/
REM   - 清理旧 dist-static
REM   - vite build (VITE_STATIC=1) → dist-static
REM ============================================
REM 注意：静态站产物输出到 streamer-dashboard\dist-static，
REM       不会覆盖 8787 日常使用的 dist 目录。
chcp 65001 >nul

set "ROOT=%~dp0"
set "SD=%~dp0streamer-dashboard"
set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"

REM 访问口令（构建后会编译进前端 JS，请妥善保管或定期更换）。
REM 也可在运行本脚本前用 `set VITE_STATIC_PASSWORD=xxx` 覆盖。
if "%VITE_STATIC_PASSWORD%"=="" set "VITE_STATIC_PASSWORD=change-me-please"

echo ============================================
echo   静态站构建 - 线下主播看板
echo ============================================
echo   ROOT = %ROOT%
echo   访问口令 = %VITE_STATIC_PASSWORD%
echo.

echo [1/3] 导出静态数据到 public\ ...
"%NODE%" "%SD%\scripts\export-static.mjs"
if errorlevel 1 goto err

echo [2/3] 清理旧 dist-static ...
"%NODE%" "%SD%\scripts\clean-dist.mjs" dist-static
if errorlevel 1 goto err

echo [3/3] vite build (静态模式) → dist-static ...
set "NODE_OPTIONS="
set "VITE_STATIC=1"
"%NODE%" "%SD%\node_modules\vite\bin\vite.js" build "%SD%" --outDir dist-static
if errorlevel 1 goto err

echo.
echo ============================================
echo   构建完成！
echo   产物位置：%SD%\dist-static
echo   部署方式：将 dist-static\ 整个目录发布到 GitHub Pages
echo   提示：本次构建不会覆盖 %SD%\dist（8787 日常使用）
echo ============================================
echo.
pause
exit /b 0

:err
echo.
echo [错误] 构建失败，请检查上方日志
pause
exit /b 1
