# 设计文档：自动采集 Trending 数据到 PostgreSQL

**日期**：2026-03-16
**状态**：已批准

---

## 目标

每天自动采集 GitHub Trending 三个周期（daily / weekly / monthly）的榜单数据，持久化到 PostgreSQL，为后续分析"开源社区注意力演进趋势"积累原始数据。

---

## 架构

### 数据库

- **实例**：NAS 上已有的 `postgres-shared` 容器（`192.168.31.14:5433`，用户 `admin`）
- **新建 database**：`github_trending`

### 表结构

**`trending_records`** — 每次采集的批次记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | |
| collected_at | TIMESTAMPTZ NOT NULL | 采集时间 |
| since | VARCHAR(10) NOT NULL | daily / weekly / monthly |
| language | VARCHAR(50) NOT NULL DEFAULT '' | 预留字段，当前始终为空字符串 |

唯一约束：用具名函数索引 `CREATE UNIQUE INDEX uix_records_since_date ON trending_records (since, DATE(collected_at))`，同一天同一周期只保留最新一条。

**`trending_repos`** — 每条批次下的具体 repo

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | |
| record_id | INT REFERENCES trending_records(id) ON DELETE CASCADE | 所属批次，级联删除 |
| rank | INT NOT NULL | 榜单排名 |
| author | VARCHAR(100) NOT NULL | repo 作者 |
| name | VARCHAR(100) NOT NULL | repo 名称 |
| description | TEXT | 英文描述 |
| description_zh | TEXT | 中文描述（DeepSeek 翻译） |
| language | VARCHAR(50) | 编程语言 |
| stars | INT | 总 star 数 |
| period_stars | INT | 本周期新增 star 数 |
| forks | INT | fork 数 |

---

## 采集流程

### 扩展 `/api/prefetch-all`

在现有端点基础上增加数据库写入逻辑：

1. 依次抓取 daily / weekly / monthly 三个周期的榜单
2. 每个周期在**单个事务**内完成：
   - Upsert `trending_records`（`ON CONFLICT ON CONSTRAINT uix_records_since_date DO UPDATE SET collected_at = NOW()`），获取 `record_id`
   - 删除该 `record_id` 下的旧 repos，再批量插入新数据
   - 任何步骤出错，整个周期事务回滚，错误记录日志；不允许在循环内 catch 单行错误后继续提交
3. **降级策略**：若数据库不可达，记录错误日志但不中断流程，JSON 文件写入照常执行
4. 现有 JSON 历史文件（`ranking-history.json`）保留，不废弃（兼容现有排名变化功能）

### 连接池

使用模块级单例 `pg.Pool`，`max: 5`（共享 NAS 实例，避免占用过多连接）。

### 定时触发

在 NAS 宿主机 crontab 中添加：

```
0 8 * * * curl -s http://localhost:3003/api/prefetch-all >> /vol1/1000/docker/github-trending/logs/cron.log 2>&1
```

每天早上 08:00 触发，输出写入日志文件，三个周期顺序执行，通常 1-2 分钟内完成。

---

## 依赖变更

- 新增 npm 依赖：`pg`（PostgreSQL 客户端）
- 新增环境变量：`DATABASE_URL`（格式：`postgresql://admin:shared2024@192.168.31.14:5433/github_trending`）
- `docker-compose.yml` 新增 `DATABASE_URL` 环境变量

---

## 不在本次范围内

- 数据分析 / 可视化界面
- 按语言分类采集（当前只采全语言榜单）
- 数据清理 / 归档策略

---

## 成功标准

- 每天 08:00 自动完成一次三周期采集，数据写入数据库
- 手动触发 `/api/prefetch-all` 同样写入数据库
- 服务重启不影响历史数据
