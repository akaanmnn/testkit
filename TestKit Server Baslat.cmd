@echo off
rem ============================================================================
rem  TestKit Server - double-click launcher for the shared machine.
rem
rem  Runs the API, the agent socket and the web UI as one process on one port.
rem  Leave this window open; closing it stops TestKit for everyone.
rem  To start it automatically at boot, point Task Scheduler at this file.
rem ============================================================================
title TestKit Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. Kurulum: https://nodejs.org/en/download
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

if not exist "node_modules" (
  echo Ilk kurulum yapiliyor...
  call npm install --no-audit --no-fund || goto :failed
)

if not exist ".env" copy ".env.example" ".env" >nul

echo Veritabani hazirlaniyor...
call npx prisma migrate deploy || goto :failed

rem Testler bu makinede kosuyor, dolayisiyla Chromium burada da gerekli.
echo Test tarayicisi kontrol ediliyor (ilk seferde birkac dakika surer)...
call npx playwright install chromium || goto :failed

echo.
echo TestKit baslatiliyor. Analistler su adresi kullanacak:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do echo    http://%%a:3001
echo.
call npm start
goto :eof

:failed
echo.
echo Baslatma tamamlanamadi. Internet baglantisini kontrol edip tekrar deneyin.
pause
exit /b 1
