@echo off
chcp 65001 >nul
title KMA Launcher v0.6.0

echo ==========================================
echo       KMA Launcher v0.6.0
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js가 없습니다.
  echo Node.js LTS를 설치해 주세요.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo [오류] Rust가 없습니다.
  echo https://rustup.rs 에서 Rust를 설치해 주세요.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/2] 프론트엔드 라이브러리 설치...
  call npm install
  if errorlevel 1 (
    echo [오류] npm install 실패
    pause
    exit /b 1
  )
)

echo [2/2] YEON Launcher 시작...
call npm run tauri:dev

echo.
echo YEON Launcher가 종료되었습니다.
pause
