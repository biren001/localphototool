@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   Checking your live site: https://localphototool.com
echo   This only reads your public website. It changes nothing.
echo.
echo ------------------------------------------------------------

where node >nul 2>nul
if %errorlevel%==0 (
  node "_dev\check-live.cjs"
) else (
  "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" "_dev\check-live.cjs"
)

echo ------------------------------------------------------------
echo.
echo   PASS = working.  FAIL = still needs a Cloudflare setting.
echo.
pause
