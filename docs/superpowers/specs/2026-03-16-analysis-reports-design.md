# 设计文档：趋势分析报告

**日期**：2026-03-16
**状态**：已批准

---

## 目标

基于每日自动采集的 trending 数据，定期生成图文并茂的深度分析报告（周/月/季/年），帮助用户理解开源社区注意力的演进趋势。

---

## 数据库

### 新增表：`analysis_reports`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | |
| report_type | VARCHAR(10) NOT NULL | weekly / monthly / quarterly / yearly |
| period_start | DATE NOT NULL | 报告覆盖起始日 |
| period_end | DATE NOT NULL | 报告覆盖截止日 |
| status | VARCHAR(10) NOT NULL DEFAULT 'pending' | pending / done / failed |
| retry_count | INT NOT NULL DEFAULT 0 | 已重试次数，上限 3 |
| content_md | TEXT | AI 生成的 Markdown 正文（含表格） |
| stats_json | JSONB | 结构化统计数据，供前端渲染图表 |
| error_msg | TEXT | 失败时的错误信息 |
| generated_at | TIMESTAMPTZ | 生成完成时间 |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |

唯一约束：`UNIQUE (report_type, period_start)`，同一周期只有一份报告。

---

## stats_json 结构

```json
{
  "total_appearances": 120,
  "unique_repos": 45,
  "new_repos": 18,
  "disappeared_repos": 12,
  "language_distribution": [
    { "language": "Python", "count": 28, "pct": 23.3 },
    { "language": "TypeScript", "count": 21, "pct": 17.5 }
  ],
  "top_repos": [
    { "author": "foo", "name": "bar", "appearances": 7, "peak_rank": 1, "avg_period_stars": 1200 }
  ],
  "new_entrants": [
    { "author": "foo", "name": "baz", "first_seen": "2026-03-10", "since": "daily" }
  ],
  "disappeared": [
    { "author": "foo", "name": "qux", "last_seen": "2026-03-08" }
  ],
  "daily_counts": [
    { "date": "2026-03-10", "daily": 13, "weekly": 14, "monthly": 17 }
  ]
}
```

---

## 报告生成流程

### 触发方式

crontab 每天 08:05 运行补偿检查脚本（晚于数据采集的 08:00）：

```
5 8 * * * curl -s http://localhost:3003/api/generate-reports >> /vol1/1000/docker/github-trending/logs/reports.log 2>&1
```

### 时区与周期边界

- NAS 系统时区：`Asia/Shanghai`（UTC+8），所有日期计算基于此时区
- **周报**：每周一触发，`period_start` = 上周一，`period_end` = 上周日
- **月报**：每月 1 日触发，`period_start` = 上月 1 日，`period_end` = 上月最后一天
- **季报**：1/4/7/10 月 1 日触发，覆盖上一个完整季度
- **年报**：每年 1 月 1 日触发，覆盖上一年

### `/api/generate-reports` 端点逻辑

无需鉴权（仅本地 NAS 内网访问，与现有其他端点一致）。

1. 计算今天（Asia/Shanghai）应该存在哪些报告
2. 查询 `analysis_reports` 表，找出：
   - 应存在但不存在的报告 → 创建 `pending` 记录
   - 状态为 `failed` 且 `retry_count < 3` 的报告 → 重新触发
3. 对每个 `pending` 报告**依次**执行生成（非并发，避免 API 配额耗尽）

### 单份报告生成步骤

1. 从 `trending_records` + `trending_repos` 聚合该时间段的统计数据，构建 `stats_json`
2. 将统计数据格式化为结构化文本，拼接提示词，调用 OpenRouter API
   - 超时设置：**120 秒**（LLM 生成长文本耗时较长）
   - 非流式请求（等待完整响应后再写库）
   - 模型：`process.env.ANALYSIS_MODEL`，默认 `anthropic/claude-sonnet-4-5`
3. AI 返回 Markdown 正文（包含叙述段落 + Markdown 表格）
4. 更新 `analysis_reports`：`status=done`、填入 `content_md` 和 `stats_json`、记录 `generated_at`
5. 任何步骤失败：`retry_count++`，`status=failed`，记录 `error_msg`

### 补偿机制

- 每天 08:05 的检查自动发现并重试失败的报告（最晚第二天重试）
- `retry_count >= 3` 后标记 `failed` 永久保留，错误信息存 `error_msg` 供人工排查，无自动告警

### 数据库迁移

在 `analyzer.js` 初始化时调用 `ensureSchema()`，检查表是否存在，不存在则创建（与现有 `ensureDataDir()` 模式一致）。部署时无需手动执行 SQL。

---

## AI 提示词设计

```
你是一位开源技术趋势分析师。以下是 GitHub Trending {period} 的统计数据：

{stats 文本化摘要}

请撰写一份深度分析报告，要求：
1. 结合近期技术圈背景（框架发布、公司动态等）解释热点成因
2. 分析社区注意力的变化方向和演进轨迹
3. 用 Markdown 格式输出，可包含表格，不要包含代码块
4. 报告结构：核心洞察（3-5条）→ 详细分析 → 趋势展望
5. 语言：中文，专业但易读
```

---

## 前端设计

### 新增 Tab：趋势报告

报告列表页：
- 按报告类型分组（周报 / 月报 / 季报 / 年报）
- 每条显示时间范围、生成状态
- 点击进入报告详情页

报告详情页包含两部分：

**数据图表区**（前端用 Chart.js 渲染 `stats_json`）：

| 图表 | 类型 | 数据来源字段 | X 轴 | Y 轴 |
|------|------|------------|------|------|
| 每日榜单 repo 数量 | 折线图 | `daily_counts` | date | daily/weekly/monthly 三条线 |
| 编程语言分布 | 横向柱状图 | `language_distribution` | language | count |
| Top 10 repo | HTML 表格 | `top_repos` | — | 出现次数、最高排名、平均新增 stars |
| 新上榜 repo | HTML 列表 | `new_entrants` | — | repo 名、首次上榜日期、周期 |
| 消失 repo | HTML 列表 | `disappeared` | — | repo 名、最后在榜日期 |

**AI 分析正文区**：
- 渲染 `content_md`（Markdown → HTML），使用 marked.js
- 支持 Markdown 表格样式

---

## 依赖变更

- 新增 npm 依赖：`marked`（Markdown 渲染，前端用 CDN 即可，无需 npm）
- 新增环境变量：
  - `OPENROUTER_API_KEY`
  - `ANALYSIS_MODEL`（默认 `anthropic/claude-sonnet-4-5`）
- `docker-compose.yml` 新增上述两个变量
- 新增后端模块：`analyzer.js`（统计聚合 + AI 调用）

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `analyzer.js` | 统计聚合 + OpenRouter 调用 + 报告生成逻辑 |
| 修改 | `server.js` | 新增 `/api/generate-reports` 和 `/api/reports` 端点 |
| 修改 | `public/app.js` | 新增报告 Tab、列表、详情页逻辑 |
| 修改 | `public/index.html` | 新增报告 Tab 按钮和容器 |
| 修改 | `public/styles.css` | 报告页样式 |
| 修改 | `docker-compose.yml` | 新增环境变量 |

---

## 不在本次范围内

- 报告的手动编辑
- 报告导出（PDF / 邮件）
- 多语言报告
- 用户自定义分析维度

---

## 成功标准

- 每周一 08:05 自动生成上周周报，月/季/年同理
- 失败后最多重试 3 次，成功率在数据完整的情况下接近 100%
- 报告详情页同时展示数据图表和 AI 叙述，图文结合
- 数据库不可达或 API Key 未配置时，服务其他功能不受影响
