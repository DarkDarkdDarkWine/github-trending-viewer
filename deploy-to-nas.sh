#!/bin/bash

# GitHub Trending Viewer - NAS Deployment Script
# Usage: ./deploy-to-nas.sh [NAS_IP] [NAS_USER]
#
# 前提：先 git push 到 GitHub，本脚本在 NAS 上 git pull 后重建镜像。

set -e

NAS_IP=${1:-"192.168.31.14"}
NAS_USER=${2:-"yt4215481"}
NAS_PATH="/vol2/1000/docker/github-trending"

echo "Deploying GitHub Trending Viewer to NAS..."
echo "  NAS: ${NAS_USER}@${NAS_IP}:${NAS_PATH}"
echo ""

ssh ${NAS_USER}@${NAS_IP} "
  set -e
  cd ${NAS_PATH}

  echo '--- git pull ---'
  git pull origin main

  echo '--- docker compose build & up ---'
  docker compose down
  docker compose build --no-cache
  docker compose up -d

  echo '--- logs (tail 20) ---'
  sleep 2
  docker compose logs --tail=20
"

echo ""
echo "Done. http://${NAS_IP}:8088"
