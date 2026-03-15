# GitHub Trending Viewer - 配置指南

## 功能说明

✅ **已实现的功能：**
1. 🌏 **UI汉化** - 全中文界面
2. ⭐ **Star状态显示** - 显示你是否已经star了该项目
3. 📊 **排名变化追踪** - 显示项目排名的上升/下降/保持/新上榜状态

## GitHub Token 配置

要使用"Star状态显示"功能，需要配置GitHub Personal Access Token。

### 1. 创建 GitHub Token

1. 访问：https://github.com/settings/tokens
2. 点击 "Generate new token" → "Generate new token (classic)"
3. 设置：
   - Note: `GitHub Trending Viewer`
   - Expiration: 选择有效期
   - 权限: 勾选 `public_repo` 或 `user`
4. 点击 "Generate token" 并复制生成的token

### 2. 配置Token

#### 方法A：使用.env文件（本地开发）

1. 复制示例文件：
```bash
cp .env.example .env
```

2. 编辑 `.env` 文件：
```env
GITHUB_TOKEN=ghp_your_token_here
```

#### 方法B：Docker环境变量（生产部署）

编辑 `docker-compose.yml`：

```yaml
services:
  github-trending:
    environment:
      - NODE_ENV=production
      - PORT=3000
      - GITHUB_TOKEN=ghp_your_token_here  # 添加这一行
```

或者使用环境变量文件：

```yaml
services:
  github-trending:
    env_file:
      - .env
```

### 3. 重启服务

```bash
# Docker
docker-compose restart

# 本地开发
npm restart
```

## 排名变化说明

排名数据会自动存储在 `data/ranking-history.json` 文件中。

### 显示规则：

- **🆕 新上榜** - 首次出现在榜单
- **↑ 数字** - 排名上升（绿色）
- **↓ 数字** - 排名下降（红色）
- **— 保持** - 排名不变（灰色）

### 数据存储：

- 每次刷新页面时自动记录当前排名
- 保留最近100次记录
- 按"时间范围"和"语言"分类存储

## 注意事项

1. **GitHub API限流**：
   - 未认证：60次/小时
   - 已认证：5000次/小时

2. **Token安全**：
   - 不要将.env文件提交到git
   - 不要公开分享你的token
   - 定期更换token

3. **排名数据**：
   - 数据存储在容器的`/app/data`目录
   - 建议映射到宿主机持久化
   - 可以定期备份`ranking-history.json`

## 常见问题

### Q: Star状态不显示？
A: 检查：
1. GITHUB_TOKEN是否正确配置
2. Token权限是否包含public_repo
3. 查看浏览器console是否有错误

### Q: 排名变化全部显示"新上榜"？
A: 正常，首次使用时没有历史数据。刷新几次后会有对比数据。

### Q: 如何清空排名历史？
A: 删除 `data/ranking-history.json` 文件并重启服务。
