# 部署到 NAS Docker 指南

## 方法 1: 自动部署脚本（推荐）

### Windows 用户

1. 编辑 `deploy-to-nas.bat`，修改 NAS IP 和用户名：
```batch
set NAS_IP=192.168.1.100  # 改为你的 NAS IP
set NAS_USER=admin        # 改为你的 NAS 用户名
```

2. 运行脚本：
```cmd
deploy-to-nas.bat
```

### Linux/Mac 用户

1. 编辑 `deploy-to-nas.sh`，修改 NAS IP 和用户名

2. 赋予执行权限并运行：
```bash
chmod +x deploy-to-nas.sh
./deploy-to-nas.sh
```

## 方法 2: 手动部署

### 步骤 1: 上传文件到 NAS

使用 SFTP/SCP 或文件管理器上传以下文件到 `/vol1/1000/docker/github-trending`：

```
github-trending/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── server.js
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```

### 步骤 2: SSH 连接到 NAS

```bash
ssh admin@你的NAS_IP
```

### 步骤 3: 构建和启动容器

```bash
cd /vol1/1000/docker/github-trending
docker-compose up -d --build
```

### 步骤 4: 查看日志

```bash
docker-compose logs -f
```

## 访问应用

部署成功后，在浏览器访问：

```
http://你的NAS_IP:3000
```

例如：`http://192.168.1.100:3000`

## 常用 Docker 命令

### 查看运行状态
```bash
docker-compose ps
```

### 停止服务
```bash
docker-compose down
```

### 重启服务
```bash
docker-compose restart
```

### 查看日志
```bash
docker-compose logs -f --tail=100
```

### 更新应用
```bash
# 1. 上传新文件到 NAS
# 2. 重新构建并启动
docker-compose down
docker-compose up -d --build
```

## 端口配置

默认端口是 3000，如需修改，编辑 `docker-compose.yml`：

```yaml
ports:
  - "8080:3000"  # 改为你想要的端口:3000
```

## 故障排查

### 容器无法启动
```bash
docker-compose logs
```

### 端口已被占用
修改 `docker-compose.yml` 中的端口映射

### 无法访问
1. 检查 NAS 防火墙设置
2. 确认端口 3000 已开放
3. 检查容器是否运行：`docker-compose ps`

## 自动启动

Docker Compose 配置中已设置 `restart: unless-stopped`，容器会在 NAS 重启后自动启动。

## 性能优化

### 内存限制
在 `docker-compose.yml` 中添加：

```yaml
deploy:
  resources:
    limits:
      memory: 256M
    reservations:
      memory: 128M
```

### 使用反向代理
如果使用 Nginx Proxy Manager 或 Traefik，可以配置域名访问。
