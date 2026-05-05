# Auto-Collect Trending Data to PostgreSQL — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每天自动采集 GitHub Trending 三个周期榜单并持久化到 PostgreSQL，为后续趋势分析积累数据。

**Architecture:** 新增独立的 `db.js` 模块管理连接池和数据库操作；扩展现有 `/api/prefetch-all` 端点，在原有 JSON 写入基础上增加数据库写入；NAS crontab 每天 08:00 触发。数据库不可达时降级运行，不影响现有功能。

**Tech Stack:** Node.js, `pg`（PostgreSQL 客户端）, PostgreSQL 15（postgres-shared 容器，端口 5433）

**Spec:** `docs/superpowers/specs/2026-03-16-auto-collect-design.md`

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `db.js` | 连接池单例 + 初始化 Schema + 数据写入函数 |
| 修改 | `server.js` | prefetch-all 端点增加 DB 写入调用 |
| 修改 | `package.json` | 新增 `pg` 依赖 |
| 修改 | `docker-compose.yml` | 新增 `DATABASE_URL` 环境变量 |
| 修改 | `.env.example` | 新增 `DATABASE_URL` 示例 |

---

## Chunk 1: 数据库初始化与 db.js 模块

### Task 1: 在 PostgreSQL 中创建数据库和表结构

**Files:**
- 无代码文件，直接在 NAS 执行 SQL

- [ ] **Step 1: 连接 postgres-shared 创建 database**

```bash
ssh -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa yt4215481@192.168.31.14 \
  "docker exec postgres-shared psql -U admin -c 'CREATE DATABASE github_trending;'"
```

预期输出：`CREATE DATABASE`

- [ ] **Step 2: 创建表结构和索引**

```bash
ssh -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa yt4215481@192.168.31.14 \
  "docker exec postgres-shared psql -U admin -d github_trending -c \"
CREATE TABLE IF NOT EXISTS trending_records (
  id           SERIAL PRIMARY KEY,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  since        VARCHAR(10) NOT NULL,
  language     VARCHAR(50) NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS uix_records_since_date
  ON trending_records (since, DATE(collected_at));

CREATE TABLE IF NOT EXISTS trending_repos (
  id             SERIAL PRIMARY KEY,
  record_id      INT NOT NULL REFERENCES trending_records(id) ON DELETE CASCADE,
  rank           INT NOT NULL,
  author         VARCHAR(100) NOT NULL,
  name           VARCHAR(100) NOT NULL,
  description    TEXT,
  description_zh TEXT,
  language       VARCHAR(50),
  stars          INT,
  period_stars   INT,
  forks          INT
);

CREATE INDEX IF NOT EXISTS idx_repos_record_id ON trending_repos (record_id);
\""
```

预期输出：`CREATE TABLE`, `CREATE INDEX`（共 4 行）

- [ ] **Step 3: 验证表结构**

```bash
ssh -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa yt4215481@192.168.31.14 \
  "docker exec postgres-shared psql -U admin -d github_trending -c '\dt'"
```

预期输出：显示 `trending_records` 和 `trending_repos` 两张表

---

### Task 2: 安装 pg 依赖，创建 db.js 模块

**Files:**
- Modify: `package.json`
- Create: `db.js`

- [ ] **Step 1: 安装 pg**

在 `~/workspace/github-trending-viewer` 目录：

```bash
cd ~/workspace/github-trending-viewer && npm install pg
```

预期：`package.json` 的 `dependencies` 中出现 `"pg": "^8.x.x"`

- [ ] **Step 2: 创建 db.js**

新建 `db.js`，内容如下：

```js
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err.message);
    });
  }
  return pool;
}

// 初始化：测试连接是否可用
async function testConnection() {
  const p = getPool();
  if (!p) return false;
  try {
    const client = await p.connect();
    client.release();
    return true;
  } catch (err) {
    console.warn('PostgreSQL not reachable:', err.message);
    return false;
  }
}

// 保存一个周期的榜单数据（单事务）
async function saveTrendingData(repos, since, language = '') {
  const p = getPool();
  if (!p) return { skipped: true, reason: 'DATABASE_URL not configured' };

  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // Upsert trending_records
    const upsertResult = await client.query(
      `INSERT INTO trending_records (since, language, collected_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT ON CONSTRAINT uix_records_since_date
       DO UPDATE SET collected_at = NOW()
       RETURNING id`,
      [since, language]
    );
    const recordId = upsertResult.rows[0].id;

    // 删除该批次旧数据
    await client.query('DELETE FROM trending_repos WHERE record_id = $1', [recordId]);

    // 批量插入（单条 INSERT 多行，注意 $1..$N 参数偏移）
    if (repos.length > 0) {
      const values = [];
      const params = [];
      repos.forEach((repo, i) => {
        const base = i * 10;
        params.push(
          recordId,
          repo.rank,
          repo.author,
          repo.name,
          repo.description || null,
          repo.descriptionZh || null,
          repo.language || null,
          repo.stars || 0,
          repo.currentPeriodStars || 0,   // 映射到 period_stars 列
          repo.forks || 0
        );
        values.push(
          `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10})`
        );
      });
      await client.query(
        `INSERT INTO trending_repos
           (record_id, rank, author, name, description, description_zh, language, stars, period_stars, forks)
         VALUES ${values.join(',')}`,
        params
      );
    }

    await client.query('COMMIT');
    console.log(`DB: saved ${repos.length} repos for ${since}`);
    return { success: true, recordId, count: repos.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { testConnection, saveTrendingData };
```

- [ ] **Step 3: 本地验证模块语法**

```bash
cd ~/workspace/github-trending-viewer && node -e "require('./db.js'); console.log('db.js OK')"
```

预期输出：`db.js OK`

- [ ] **Step 4: Commit**

```bash
cd ~/workspace/github-trending-viewer && \
  git add package.json package-lock.json db.js && \
  git commit -m "feat: add pg dependency and db.js module"
```

---

## Chunk 2: 扩展 prefetch-all + 配置更新

### Task 3: 扩展 /api/prefetch-all 写入数据库

**Files:**
- Modify: `server.js`（`/api/prefetch-all` 端点，约第 480-499 行）

- [ ] **Step 1: 在 server.js 顶部引入 db.js**

在 `server.js` 第一行 `require('dotenv').config();` 之后，加入：

```js
const db = require('./db');
```

- [ ] **Step 2: 替换 /api/prefetch-all 端点**

将现有端点（`app.get('/api/prefetch-all', ...)`）替换为：

```js
app.get('/api/prefetch-all', async (req, res) => {
  try {
    const periods = ['daily', 'weekly', 'monthly'];
    const results = [];

    for (const since of periods) {
      try {
        const repos = await scrapeTrending(since, '');
        // 原有 JSON 历史（兼容排名变化功能）
        await updateRankingHistory(repos, since, '');

        // 写入数据库（降级：失败不中断）
        try {
          const dbResult = await db.saveTrendingData(
            repos.map((r, i) => ({ ...r, rank: i + 1 })),
            since,
            ''   // language：当前 prefetch-all 只抓全语言榜
          );
          results.push({ since, success: true, count: repos.length, db: dbResult });
        } catch (dbErr) {
          console.error(`DB write failed for ${since}:`, dbErr.message);
          results.push({ since, success: true, count: repos.length, db: { error: dbErr.message } });
        }
      } catch (err) {
        results.push({ since, success: false, error: err.message });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

- [ ] **Step 3: 本地验证语法**

```bash
cd ~/workspace/github-trending-viewer && node -e "require('./server.js')" 2>&1 | head -5
```

预期：看到 `🚀 Server running` 启动日志，无报错

用 Ctrl+C 停止。

- [ ] **Step 4: Commit**

```bash
cd ~/workspace/github-trending-viewer && \
  git add server.js && \
  git commit -m "feat: save trending data to PostgreSQL in prefetch-all"
```

---

### Task 4: 更新配置文件

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: 更新 docker-compose.yml**

在 `environment:` 列表末尾（`DEEPSEEK_API_KEY` 行之后）添加：

```yaml
      - DATABASE_URL=postgresql://admin:shared2024@192.168.31.14:5433/github_trending
```

- [ ] **Step 2: 更新 .env.example**

在文件末尾追加：

```
# PostgreSQL 连接（可选，不配置则跳过数据库写入）
DATABASE_URL=postgresql://user:password@host:5433/github_trending
DEEPSEEK_API_KEY=your_deepseek_key_here
```

- [ ] **Step 3: Commit**

```bash
cd ~/workspace/github-trending-viewer && \
  git add docker-compose.yml .env.example && \
  git commit -m "chore: add DATABASE_URL to docker-compose and env example"
```

---

## Chunk 3: 部署与 crontab

### Task 5: 部署到 NAS 并配置 crontab

**Files:**
- 无本地文件变更，全部在 NAS 执行

- [ ] **Step 1: 同步文件到 NAS**

```bash
rsync -avz --exclude 'node_modules' --exclude '.git' \
  -e "ssh -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa" \
  ~/workspace/github-trending-viewer/ \
  yt4215481@192.168.31.14:/vol1/1000/docker/github-trending/
```

- [ ] **Step 2: 重建并启动容器**

```bash
ssh -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa yt4215481@192.168.31.14 \
  "cd /vol1/1000/docker/github-trending && docker compose down && docker compose up -d --build"
```

预期：容器重新构建并启动，`STATUS: Up`

- [ ] **Step 3: 等待容器就绪，验证 DB 写入**

```bash
sleep 5 && curl -s http://192.168.31.14:3003/api/prefetch-all | python3 -c "
import json, sys
r = json.load(sys.stdin)
for item in r.get('results', []):
    print(item['since'], '✓' if item.get('success') else '✗', item.get('db', {}))
"
```

预期：三个周期各显示 `success: true`，db 字段显示 `recordId` 和 `count`

- [ ] **Step 4: 验证数据库实际有数据**

```bash
ssh -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa yt4215481@192.168.31.14 \
  "docker exec postgres-shared psql -U admin -d github_trending \
   -c 'SELECT since, count(*) FROM trending_records r JOIN trending_repos rp ON r.id=rp.record_id GROUP BY since;'"
```

预期：daily / weekly / monthly 各有若干条 repo 记录

- [ ] **Step 5: 创建日志目录**

```bash
ssh -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa yt4215481@192.168.31.14 \
  "mkdir -p /vol1/1000/docker/github-trending/logs"
```

- [ ] **Step 6: 添加 crontab**

```bash
ssh -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa yt4215481@192.168.31.14 \
  "(crontab -l 2>/dev/null; echo '0 8 * * * curl -s http://localhost:3003/api/prefetch-all >> /vol1/1000/docker/github-trending/logs/cron.log 2>&1') | crontab -"
```

- [ ] **Step 7: 验证 crontab**

```bash
ssh -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa yt4215481@192.168.31.14 "crontab -l"
```

预期：显示 `0 8 * * * curl -s http://localhost:3003/api/prefetch-all ...`

- [ ] **Step 8: 推送代码到 GitHub**

```bash
cd ~/workspace/github-trending-viewer && \
  TOKEN=$(cat ~/.claude/skills/ssh-manager/github.com/personal_access_token.txt) && \
  git push "https://DarkDarkdDarkWine:${TOKEN}@github.com/DarkDarkdDarkWine/github-trending-viewer.git"
```

---

## 验收标准

- [ ] `GET /api/prefetch-all` 返回三个周期均有 `db.recordId`
- [ ] PostgreSQL 中 `trending_repos` 有数据，可按 `since` 分组查询
- [ ] 数据库连接断开时服务正常启动，`/api/trending` 正常响应
- [ ] NAS crontab 已配置，日志目录存在
