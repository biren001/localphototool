@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Pass "nopause" to run it unattended (e.g. from a script or CI).
set "NOPAUSE=0"
if /i "%~1"=="nopause" set "NOPAUSE=1"
if not exist "_dev\.tmp" mkdir "_dev\.tmp"
set "LOG=_dev\last-run.log"
echo.
echo   Local test suite - runs against the copy of the site in localphototool\
echo   Nothing here touches the live site or uploads a single byte.
echo   (For the live site, use run-check.bat instead.)
echo.
echo ------------------------------------------------------------

where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE=node"
) else (
  set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
)
rem The browser tests require('playwright-core') from the managed workspace.
set "NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules"

rem ">" on the first line so each run starts a fresh log: two runs mixed
rem together in one file is worse than no file.
echo Local test suite - %DATE% %TIME% > "%LOG%"
echo. >> "%LOG%"
set FAILED=0
for %%T in (
  check-listing-copy
  test-pages
  test-counter
  test-stats
  test-engine
  test-format
  test-headers
  test-ios-save
  test-browser
  test-pwa
  test-chime
  test-share
  test-heic
  test-warmup
  test-fidelity
  test-update
  audit-nav
  audit-overflow
) do (
  echo.
  echo ==== %%~T
  echo ==== %%~T >> "%LOG%"
  rem Each test's output is captured so it can be shown AND kept: a run that
  rem fails at 2am is worth more as a file than as scrollback.
  "%NODE%" "_dev\%%~T.cjs" > "_dev\.tmp\one.log" 2>&1
  if errorlevel 1 set FAILED=1
  type "_dev\.tmp\one.log"
  type "_dev\.tmp\one.log" >> "%LOG%"
)

echo.
echo ------------------------------------------------------------
if %FAILED%==1 (
  echo   Something FAILED - scroll up for the ^"FAIL^" lines.
  echo FAILED >> "%LOG%"
) else (
  echo   All local checks passed.
  echo All local checks passed. >> "%LOG%"
)
echo.
echo   Full output saved to %LOG%
echo.
if "%NOPAUSE%"=="0" pause
if "%NOPAUSE%"=="1" exit /b %FAILED%
