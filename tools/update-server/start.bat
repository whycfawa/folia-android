@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没找到 Node.js，请先安装：https://nodejs.org/
  pause
  exit /b 1
)

if not defined PORT set "PORT=8787"

rem 密码：第一次运行自动生成并存进 admin-password.txt，之后一直复用它。
if exist "admin-password.txt" (
  set /p ADMIN_PASSWORD=<admin-password.txt
) else (
  for /f "delims=" %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N').Substring(0,16)"') do set "ADMIN_PASSWORD=%%i"
  >admin-password.txt echo !ADMIN_PASSWORD!
)

if not exist "node_modules" (
  echo 首次运行，正在安装依赖...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
  )
)

echo.
echo ==========================================================
echo   Folia 更新面板：http://127.0.0.1:%PORT%
echo   管理密码：!ADMIN_PASSWORD!
echo   密码保存在 admin-password.txt，可自行修改
echo ==========================================================
echo.
echo 服务已启动，关闭这个窗口即停止。
echo.

if not defined FOLIA_NO_BROWSER start "" "http://127.0.0.1:%PORT%"
node server.js
pause
