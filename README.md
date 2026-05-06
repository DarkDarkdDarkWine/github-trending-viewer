# GitHub Trending Viewer v1.6.0

一个精美的 GitHub 热门项目查看器，支持中文界面、Star 状态追踪、排名变化、AI 翻译、每日 AI 深度解读、个人 Star 仓库动态监控和自动报告生成。

## ✨ 功能特性

### 🎯 核心功能
- **🔥 热门趋势查看** - 查看 GitHub 每日/每周/每月热门项目
- **🌏 全中文界面** - 完整的汉化 UI 和提示信息
- **⏰ 定时自动抓取** - node-cron 每日 3 次自动抓取榜单入库，无需依赖用户访问

### 🤖 AI 增强
- **流式翻译** - 页面加载后自上而下逐条翻译，闪光动画实时反馈翻译进度
- **翻译失败标记** - 失败项波浪下划线高亮，hover 显示原因
- **每日 AI 解读** - 每天自动生成日报，AI 阅读每个仓库的 README 后撰写一句话中文简介
- **简介缓存** - 30 天内同一仓库复用已生成的简介，节省 AI Token 消耗
- **多供应商支持** - DeepSeek / GLM / MiniMax / 硅基流动 / OpenRouter，可自由分配翻译和报告任务

### ⭐ Star 相关
- **Star 状态显示** - 显示你是否已 Star 该项目
- **一键跳转** - 点击跳转到 GitHub 页面

### 📊 排名追踪
- **排名变化指示** - 显示排名上升↑/下降↓/保持—
- **新上榜标记** - 标记首次出现的项目
- **颜色标识** - 绿色(上升)、红色(下降)、灰色(保持)、蓝色(新上榜)

### ⭐ 我的 Star 仪表盘
- **仪表盘视图** - 按仓库组织的卡片网格，替代旧版平铺事件流
- **摘要统计栏** - 显示总仓库数、有新版本数、本周活跃数
- **Release 优先排序** - 有新版本的仓库排在前面，一目了然
- **Trending 联动** - Trending 页面支持"只看我 Star 的"过滤按钮

### 📈 三层报告体系

| 级别 | 频率 | 定位 | 核心内容 |
|------|------|------|---------|
| **日报** | 每天 | 技术情报简报 | 今日信号叙事 → Top 10 定性判断 → 值得深看精选 → 一刻钟速览 |
| **周报** | 每周一 | 趋势周评 | 核心信号 → 升温/降温方向 → 新面孔分析 → 下周看点预测 |
| **月报** | 每月 1 日 | 战略月度综述 | 本月格局判断 → 深度专题 → 本月之星点评 → 未来三个月前瞻 |

- **AI 合成** — 日报由 AI 综合 README 摘要、排名数据、历史 streak 信息生成，非模板拼凑
- **数据驱动** — 周报/月报引用每日简介 + 语言分布 + 每日上榜变化，分析有据可查
- **自动调度** — node-cron 定时抓取后自动触发，无需手动操作

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

```bash
# 构建并启动
docker compose up -d --build

# 访问 http://localhost:3000
```

## ⚙️ 配置说明

### 环境变量

```bash
# .env 文件
GITHUB_TOKEN=ghp_your_token_here       # GitHub API（Star 状态、README 获取）
DATABASE_URL=postgresql://...           # PostgreSQL（报告存储、简介缓存）
```

- GitHub Token: https://github.com/settings/tokens (需要 `public_repo` 或 `user` 权限)
- AI API Key 通过 Web 界面「AI 设置」页签配置，支持多供应商

### AI 供应商配置

在「AI 设置」页签中：
1. 选择供应商（DeepSeek / GLM / MiniMax / 硅基流动 / OpenRouter）
2. 填入 API Key，点击「保存」（自动连通测试）
3. 选择翻译和报告各自使用的模型
4. 在「任务分配」中指定翻译和报告由哪个供应商负责

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
失败时返回：`data: {"index": 0, "error": true, "message": "..."}`

### 检查 Star 状态

```
POST /api/check-starred
Body: { "repos": [{ "owner": "user", "name": "repo" }] }
```

### 获取 Star 仓库动态

```
GET /api/starred-activity
```

### 获取 Star 仪表盘

```
GET /api/starred-dashboard
```

返回按仓库组织的仪表盘数据，包含摘要统计、最新 Release 和近期 Commits。

### 获取分析报告列表

```
GET /api/reports
```

返回所有已生成的报告（日报/周报/月报），按时间倒序。

### 获取单份报告详情

```
GET /api/reports/:id
```

返回报告的完整内容，包括 Markdown 分析文本和统计数据。

### 手动触发报告生成

```
GET /api/generate-reports
```

手动触发检查并生成应生成的报告。

### AI 供应商管理

```
GET    /api/ai-providers              # 获取所有供应商及配置状态
POST   /api/ai-providers              # 添加/更新供应商 Key
DELETE /api/ai-providers/:id          # 删除供应商配置
POST   /api/ai-providers/test         # 测试连通性
POST   /api/ai-providers/models       # 拉取可用模型列表
PUT    /api/ai-providers/:id/models   # 更新模型选择
GET    /api/ai-providers/task-assign  # 获取任务分配
PUT    /api/ai-providers/task-assign  # 更新任务分配
```

## 🏗️ 项目结构

```
github-trending-viewer/
├── server.js              # Express 后端服务 + API 路由
├── github-client.js       # GitHub API 客户端（Octokit + GraphQL + 缓存）
├── db.js                  # PostgreSQL 数据库模块（trending / reports / summaries）
├── analyzer.js            # 报告生成模块（日报/周报/月报）
├── ai-provider.js         # AI 供应商管理（多供应商、模型选择、任务分配）
├── summarizer.js          # README 获取 → AI 摘要 → 30天缓存
├── scheduler.js           # 定时调度器（每日自动抓取 + 报告生成）
├── package.json           # 项目依赖
├── Dockerfile             # Docker 镜像构建
├── docker-compose.yml     # Docker 编排配置
├── .env.example           # 环境变量示例
├── public/
│   ├── index.html         # 主页面（4 个页签）
│   ├── styles.css         # 样式（暗色主题 + 翻译动画）
│   └── app.js             # 前端逻辑
├── __tests__/             # 测试文件（26 个测试）
├── data/                  # 运行时数据（排名历史、AI 配置）
└── SETUP.md               # 配置指南
```

## 🛠️ 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript
- **数据抓取**: Cheerio + Axios
- **定时调度**: node-cron
- **GitHub API**: @octokit/rest + @octokit/graphql
- **翻译 & 摘要**: DeepSeek V4 / GLM / MiniMax / 硅基流动 / OpenRouter
- **数据库**: PostgreSQL
- **部署**: Docker

## 📝 更新日志

### v1.6.0 (2026-05-06)
- 📝 **每日 AI 深度报告** — 每天自动生成日报，AI 逐项目阅读 README 并撰写中文简介
- 💾 **简介 30 天缓存** — `repo_summaries` 表，同一仓库 30 天内复用已生成的简介
- 🤖 **多 AI 供应商支持** — 新增 GLM / MiniMax / 硅基流动 / OpenRouter，Web 界面自由切换
- 🔄 **翻译体验升级** — 自上而下有序翻译，闪光动画（shimmer）反馈进度，失败项波浪下划线标记
- ⏰ **定时自动抓取** — node-cron 每日 3 次自动抓取榜单入库，补齐数据缺口
- 📊 **周报/月报增强** — 引用每日 AI 简介，趋势分析更精准
- 🧩 **新增模块** — `scheduler.js`（定时调度）、`summarizer.js`（README 摘要）
- 🐛 修复 DeepSeek V4 Flash 翻译空响应（max_tokens 100→300）
- 🐛 修复 reasoning_content 混入输出内容的 Bug
- 🐛 修复 Docker 部署 volume 缺失导致配置丢失
- 🧪 26 个测试全通过

### v1.5.0 (2026-04-16)
- ⭐ Star 页签重新设计为仪表盘风格：卡片网格 + 摘要统计栏
- ⭐ 新增 `/api/starred-dashboard` API，按仓库组织返回 Release 和 Commits 快照
- ⭐ Release 优先排序：有新版本的仓库排在前面
- 🔗 Trending 页面新增"只看我的 Star"过滤按钮，支持 URL 参数持久化
- 📱 页签名称简化：「我的Star动态」→「我的 Star」
- 🧪 新增 6 个测试（dashboard 函数 + 路由），总计 26 个测试

### v1.4.0 (2026-04-16)
- 🚀 GitHub API 层重构：引入 `@octokit/rest` + `@octokit/graphql`，替换原始 Axios 调用
- ⚡ Star 状态检查从 20 次 REST 调用优化为 1 次 GraphQL 批量查询
- ⚡ Starred 动态从 60 次 REST 调用优化为 2 次 GraphQL 批量查询
- 📦 新增 `github-client.js` 模块，封装所有 GitHub API 交互
- 💾 新增服务端 TTL 缓存：trending 爬取结果缓存 5 分钟，API 响应缓存 5-10 分钟
- 🐛 修复 Dockerfile healthcheck 指向不存在的 `/api/languages` 端点
- 🧪 新增 20 个单元/集成测试（Jest + Supertest）

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
