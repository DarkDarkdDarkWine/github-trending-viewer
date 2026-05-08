#!/bin/bash

# GitHub Trending Viewer - NAS Deployment Script
# Usage: ./deploy-to-nas.sh [NAS_IP] [NAS_USER]

set -e

NAS_IP=${1:-"192.168.31.14"}  # 默认 NAS IP
NAS_USER=${2:-"yt4215481"}     # 默认用户名
NAS_PATH="/vol2/1000/docker/github-trending"

echo "🚀 Deploying GitHub Trending Viewer to NAS..."
echo "   NAS IP: $NAS_IP"
echo "   User: $NAS_USER"
echo "   Path: $NAS_PATH"
echo ""

# 创建 NAS 目录
echo "📁 Creating directory on NAS..."
ssh ${NAS_USER}@${NAS_IP} "mkdir -p ${NAS_PATH}"

# 同步文件到 NAS
echo "📦 Syncing files to NAS..."
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'plan' \
  --exclude '*.log' \
  ./ ${NAS_USER}@${NAS_IP}:${NAS_PATH}/

# 在 NAS 上构建和启动容器
echo "🐳 Building and starting Docker container..."
ssh ${NAS_USER}@${NAS_IP} << 'EOF'
cd /vol2/1000/docker/github-trending
docker-compose down
docker-compose build --no-cache
docker-compose up -d
docker-compose logs --tail=50
EOF

echo ""
echo "✅ Deployment complete!"
echo "🌐 Access the app at: http://${NAS_IP}:8088"
