@echo off
rem ============================================================================
rem  TestKit Agent - double-click launcher
rem
rem  Ships alongside the agent folder so an analyst never opens a terminal. It
rem  installs what is missing, then starts the agent and leaves this window open
rem  as the status display. Closing the window stops the agent.
rem ============================================================================
title TestKit Agent
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi.
  echo Lutfen BT ekibinden Node.js LTS kurulumunu isteyin: https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)

rem ---------------------------------------------------------------------------
rem  Node surumu kontrolu. Prisma, Playwright ve Vite Node 18 altinda hic
rem  calismaz; bunu kurulumun ortasinda anlamak yerine burada soyluyoruz.
rem ---------------------------------------------------------------------------
for /f "tokens=1 delims=." %%v in ('node -v') do set NODEMAJOR=%%v
set NODEMAJOR=%NODEMAJOR:v=%
if %NODEMAJOR% LSS 20 (
  echo.
  echo ================================================================
  echo  Node.js surumunuz cok eski.
  echo.
  node -v
  echo  Gereken: Node.js 20 LTS veya 22 LTS
  echo.
  echo  Kurulum: https://nodejs.org  ^(LTS surumunu indirin^)
  echo  Kurduktan sonra bu pencereyi kapatip yeniden acin.
  echo ================================================================
  echo.
  pause
  exit /b 1
)

if not exist "..\..\node_modules" (
  echo Ilk kurulum yapiliyor, bu birkac dakika surebilir...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo Kurulum tamamlanamadi. Internet baglantisini kontrol edip tekrar deneyin.
    pause
    exit /b 1
  )
)

echo.
call npm run start --silent
echo.
echo TestKit Agent kapandi.
pause
