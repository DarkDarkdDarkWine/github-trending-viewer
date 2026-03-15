@echo off
REM GitHub Trending Viewer - NAS Deployment Script (Windows)
REM Usage: deploy-to-nas.bat [NAS_IP] [NAS_USER]

setlocal

set NAS_IP=%1
set NAS_USER=%2
set NAS_PATH=/vol1/1000/docker/github-trending

if "%NAS_IP%"=="" set NAS_IP=192.168.31.14
if "%NAS_USER%"=="" set NAS_USER=admin

echo ======================================
echo GitHub Trending Viewer - NAS Deployment
echo ======================================
echo NAS IP: %NAS_IP%
echo User: %NAS_USER%
echo Path: %NAS_PATH%
echo.

echo [1/3] Creating directory on NAS...
ssh %NAS_USER%@%NAS_IP% "mkdir -p %NAS_PATH%"

echo [2/3] Copying files to NAS...
scp -r Dockerfile docker-compose.yml package.json server.js public %NAS_USER%@%NAS_IP%:%NAS_PATH%/

echo [3/3] Building and starting Docker container...
ssh %NAS_USER%@%NAS_IP% "cd %NAS_PATH% && docker-compose down && docker-compose up -d --build"

echo.
echo ========================================
echo Deployment Complete!
echo Access the app at: http://%NAS_IP%:3003
echo ========================================

pause
