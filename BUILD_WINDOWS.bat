@echo off
chcp 65001 >nul
title YEON Launcher Windows Build

echo ==========================================
echo     YEON Launcher Windows Build
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js가 필요합니다.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo [오류] Rust가 필요합니다.
  pause
  exit /b 1
)

if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo [오류] npm install 실패
    pause
    exit /b 1
  )
)

call npm run tauri:build
if errorlevel 1 (
  echo.
  echo [오류] 빌드 실패
  pause
  exit /b 1
)

echo.
echo 빌드 완료!
echo 설치 파일 위치:
echo src-tauri\target\release\bundle\
pause
