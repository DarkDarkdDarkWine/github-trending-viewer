@echo off
REM Quick Test Script - GitHub Trending Viewer

echo ========================================
echo GitHub Trending Viewer - Quick Test
echo ========================================
echo.

echo [1/3] Installing dependencies...
call npm install

if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo [2/3] Starting server...
echo.
echo ----------------------------------------
echo Server will start on http://localhost:3000
echo Press Ctrl+C to stop the server
echo ----------------------------------------
echo.

start http://localhost:3000

node server.js
