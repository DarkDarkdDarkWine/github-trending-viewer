# Star 仓库仪表盘设计

## 背景

当前"我的 Star 动态"页签是一个平铺的事件流（50 条 PushEvent/ReleaseEvent），信息噪音大、同仓库动态分散、与 Trending 页面割裂，用户几乎不使用。需要重新设计为仪表盘风格，并增强与 Trending 页面的关联。

## 改动范围

### 1. 后端：新 API `/api/starred-dashboard`

替代现有 `/api/starred-activity`，返回按仓库组织的状态快照。

**数据获取**：复用现有 GraphQL 批量查询（30 个仓库分 2 批，每批 15 个），在一次查询中同时获取：
- 仓库基础信息：description, language, stargazersCount, updatedAt, forksCount
- 最新 1 个 Release：tagName, name, description, publishedAt
- 最新 3 个 commits：messageHeadline, oid, authoredDate, author

**响应格式**：

```json
{
  "success": true,
  "data": {
    "summary": {
      "total_starred": 87,
      "shown": 30,
      "with_release": 12,
      "active_7d": 34
    },
    "repos": [
      {
        "owner": "n8n-io",
        "name": "n8n",
        "full_name": "n8n-io/n8n",
        "description": "Workflow automation...",
        "language": "TypeScript",
        "stars": 75200,
        "forks": 2100,
        "url": "https://github.com/n8n-io/n8n",
        "updated_at": "2026-04-16T10:00:00Z",
        "latest_release": {
          "tag": "v1.5.0",
          "name": "n8n 1.5.0",
          "body": "## New Features\n...",
          "date": "2026-04-14T00:00:00Z"
        },
        "recent_commits": [
          { "message": "fix: resolve auth timeout", "sha": "abc123d", "date": "2026-04-16T10:00:00Z", "author": "dev" }
        ]
      }
    ]
  }
}
```

**排序规则**：Release 优先 + 时间倒序
1. 有 Release 的仓库在前，按 Release 发布时间倒序
2. 无 Release 的仓库在后，按最近 commit 时间倒序
3. 都没有的按 updated_at 倒序

**实现**：在 `github-client.js` 中新增 `getStarredDashboard()` 函数，修改 GraphQL 查询以获取更丰富的仓库字段。在 `server.js` 中新增路由。

**旧 API `/api/starred-activity` 保留**，不删除（向后兼容），但前端不再调用。

### 2. 前端：仪表盘页签

**页签名改**：「我的 Star 动态」→「我的 Star」

#### 顶部摘要栏

```
⭐ 87 个仓库  |  📦 12 个有新版本  |  🔥 34 个本周活跃
```

- `87 个仓库`：用户 Star 仓库总数（从 summary.total_starred）
- `12 个有新版本`：展示的 30 个中有 Release 的数量
- `34 个本周活跃`：最近 7 天有 commit 或 release 的数量

#### 仓库卡片网格

每张卡片展示一个仓库：

```
┌─────────────────────────────────────────────┐
│ n8n-io / n8n                    TypeScript  │
│ 📦 v1.5.0 · Apr 14             ⭐ 75.2K    │
│ Workflow automation tool...                  │
│─────────────────────────────────────────────│
│ abc123d fix: resolve auth timeout · 2h ago  │
│ def4567 feat: add new node type · 5h ago    │
│ ghi8901 docs: update README · 1d ago        │
└─────────────────────────────────────────────┘
```

卡片结构：
- **标题行**：owner/name + 语言标签（颜色点 + 文字）
- **Release 行**（如有）：📦 tag + 发布日期，高亮显示
- **描述**：仓库描述
- **底部**：最近 commits 折叠显示（最多 3 条），每条显示 sha(7位) + message + time ago
- **右下角**：⭐ star 数量

点击仓库名跳转 GitHub。

### 3. Trending 页面关联

在 Trending 页面的过滤区域增加一个按钮：

```
时间范围：[今天 | 本周 | 本月]   [🔄 刷新]   [⭐ 只看我 Star 的]
```

- 按钮切换状态，点击后 Trending 列表过滤为只显示已 Star 的项目
- 前端过滤（starredStatus 已有数据），无需新 API
- 按钮状态用 `?starred=true` URL 参数持久化

### 4. 不改动的部分

- `/api/starred-activity` 保留，不删除
- AI 设置、报告页签不变
- 数据库不变
- Docker 部署不变

## 文件清单

| 文件 | 操作 |
|------|------|
| `github-client.js` | 新增 `getStarredDashboard()` |
| `server.js` | 新增 `/api/starred-dashboard` 路由 |
| `public/app.js` | 重写 Star 页签为仪表盘；Trending 加 Star 过滤 |
| `public/index.html` | Star 页签 HTML 结构调整；Trending 加过滤按钮 |
| `public/styles.css` | 仪表盘卡片样式 |
| `__tests__/github-client.test.js` | 新增 dashboard 相关测试 |
| `__tests__/server-routes.test.js` | 新增 dashboard 路由测试 |

## 验证方式

1. 所有测试通过（`npm test`）
2. NAS 部署后访问 Star 页签：顶部摘要栏数据正确，仓库卡片按 Release 优先排序
3. 有 Release 的卡片高亮，无 Release 的卡片只显示 commits
4. Trending 页面点击"只看我 Star 的"，列表正确过滤
5. 无 GITHUB_TOKEN 时，Star 页签显示友好提示
