# GitHub Trending Viewer v1.3.0

一个精美的 GitHub 热门项目查看器，支持中文界面、Star 状态追踪、排名变化、AI 翻译、个人 Star 仓库动态监控和自动报告生成。

## ✨ 功能特性

### 🎯 核心功能
- **🔥 热门趋势查看** - 查看 GitHub 每日/每周/每月热门项目
- **🌏 全中文界面** - 完整的汉化 UI 和提示信息

### ⭐ Star 相关
- **Star 状态显示** - 显示你是否已 Star 该项目
- **一键跳转** - 点击跳转到 GitHub 页面

### 📊 排名追踪
- **排名变化指示** - 显示排名上升↑/下降↓/保持—
- **新上榜标记** - 标记首次出现的项目
- **颜色标识** - 绿色(上升)、红色(下降)、灰色(保持)、蓝色(新上榜)

### 🤖 AI 增强
- **DeepSeek 流式翻译** - 页面加载后立即展示，翻译结果逐条推送更新，无需等待全部完成
- **智能翻译** - 比机器翻译更自然的本地化体验

### 📱 我的 Star 动态
- **仓库更新监控** - 追踪你 Star 的仓库的最新 Release 和提交
- **时间线展示** - 按时间排序的活动流
- **过滤噪音** - 自动过滤 "谁 Star 了" 等不相关事件

### 📈 自动报告生成（新）
- **周报自动生成** - 每周一自动生成上周 GitHub Trending 分析报告
- **月报自动生成** - 每月1日自动生成上月分析报告
- **深度 AI 分析** - 使用 DeepSeek 分析技术趋势、热点成因和社区注意力变化
- **数据可视化** - 展示 Top 项目、语言分布、每日上榜数量等统计数据

## 🚀 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 启动服务
npm start

# 访问 http://localhost:3000
```

### 开发模式（热重载）

```bash
npm run dev
```

## 🐳 Docker 部署

### 方式一：一键部署到 NAS

```bash
# Windows
deploy-to-nas.bat 192.168.31.14 admin

# Linux/Mac
./deploy-to-nas.sh 192.168.31.14 admin
```

### 方式二：手动部署

```bash
# 1. 复制文件到 NAS
scp -r . user@nas:/path/to/deploy

# 2. 构建并启动
docker compose up -d --build

# 3. 访问 http://NAS_IP:3000
```

## ⚙️ 配置说明

### GitHub Token（可选）

用于查询 Star 状态和翻译功能：

```bash
# .env 文件
GITHUB_TOKEN=ghp_your_token_here
DEEPSEEK_API_KEY=sk-your_deepseek_key
```

获取 GitHub Token: https://github.com/settings/tokens (需要 `public_repo` 或 `user` 权限)

获取 DeepSeek API Key: https://platform.deepseek.com

## 📡 API 接口

### 获取热门项目

```
GET /api/trending?since=weekly
```

参数：
- `since`: `daily` | `weekly` | `monthly`

返回按本周期新增 star 数降序排列，最多 20 条。

### 流式翻译（SSE）

```
POST /api/translate
Body: { "texts": [{ "index": 0, "text": "description" }] }
```

以 SSE 格式逐条返回翻译结果：`data: {"index": 0, "translation": "..."}`

### 检查 Star 状态

```
POST /api/check-starred
Body: { "repos": [{ "owner": "user", "name": "repo" }] }
```

### 获取 Star 仓库动态

```
GET /api/starred-activity
```

### 获取分析报告列表

```
GET /api/reports
```

返回所有已生成的报告列表，按时间倒序。

### 获取单份报告详情

```
GET /api/reports/:id
```

返回报告的完整内容，包括 Markdown 分析文本和统计数据。

### 手动触发报告生成

```
POST /api/reports/generate
```

手动触发检查并生成应生成的报告（周报/月报）。

## 🏗️ 项目结构

```
github-trending-viewer/
├── server.js              # Express 后端服务
├── db.js                  # PostgreSQL 数据库模块
├── analyzer.js            # 报告生成模块（周报/月报）
├── package.json           # 项目依赖
├── docker-compose.yml     # Docker 配置
├── .env.example          # 环境变量示例
├── public/
│   ├── index.html        # 主页面
│   ├── styles.css        # 样式文件
│   └── app.js            # 前端逻辑
├── data/                  # 数据存储（排名历史）
└── SETUP.md              # 配置指南
```

## 🛠️ 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript
- **数据抓取**: Cheerio + Axios
- **翻译**: DeepSeek AI
- **部署**: Docker

## 📝 更新日志

### v1.3.0 (2026-03-24)
- 📈 新增自动报告生成功能：周一自动生成上周周报，每月1日生成上月月报
- 🤖 报告内容由 DeepSeek AI 深度分析，包含技术趋势解读和社区注意力变化
- 📊 新增报告查看页面，展示 Top 项目、语言分布、每日上榜统计
- 🔌 新增 `/api/reports` 相关 API 端点
- 📁 数据库新增 `reports` 表存储报告内容

### v1.2.0 (2026-03-18)
- 🗑️ 移除语言筛选功能，简化前后端复杂度
- 🗑️ 移除 `/api/prefetch-all`，消除每次浏览时的隐式三轮额外抓取
- 🔒 修复前端多处 XSS 风险，新增 `escapeAttr()` 覆盖 HTML 属性上下文
- 🐛 修复 DB `trending_records.language` 冗余列，已执行 migration 删除
- 🐛 修复无 GitHub Token 时 `/api/check-starred` 返回 `null[]` 导致前端报错
- 📈 Star 动态改为拉取最近更新的 starred 仓库（`sort=updated`），检查范围从 10 扩大至 30
- 📈 Star 动态同时拉取 releases 和 commits，不再因有 release 而屏蔽 commit 动态
- 🛡️ 抓取结果为空时抛出结构变更错误，不再静默返回空数据
- 🔧 新增 ESLint 配置

### v1.1.0 (2026-03-16)
- 📊 各周期榜单按本周期新增 star 数排序，取前 20 名
- ⚡ AI 翻译改为流式推送（SSE）：页面立即展示英文，翻译逐条到达后原地更新
- 🔌 新增 `/api/translate` SSE 端点

### v1.0.0 (2026-02-01)
- ✨ 首发版本
- 🌏 全中文 UI
- ⭐ Star 状态查询
- 📊 排名变化追踪
- 🤖 DeepSeek AI 翻译
- 📱 Star 仓库动态监控

## 📄 许可证

MIT License

---

**GitHub Trending Viewer** - 让 GitHub 趋势更易懂 🚀
