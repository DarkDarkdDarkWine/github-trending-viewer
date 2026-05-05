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
async function saveTrendingData(repos, since) {
  const p = getPool();
  if (!p) return { skipped: true, reason: 'DATABASE_URL not configured' };

  let client;
  try {
    client = await p.connect();
    await client.query('BEGIN');

    // Upsert trending_records — conflict key (since, collect_date) is correct
    // now that language filtering has been removed
    const upsertResult = await client.query(
      `INSERT INTO trending_records (since, collected_at, collect_date)
       VALUES ($1, NOW(), CURRENT_DATE)
       ON CONFLICT (since, collect_date)
       DO UPDATE SET collected_at = NOW()
       RETURNING id`,
      [since]
    );
    const recordId = upsertResult.rows[0].id;

    // 删除该批次旧数据
    await client.query('DELETE FROM trending_repos WHERE record_id = $1', [recordId]);

    // 批量插入（单条 INSERT 多行）
    if (repos.length > 0) {
      const values = [];
      const params = [];
      repos.forEach((repo, i) => {
        const base = i * 10;
        params.push(
          recordId,
          i + 1,
          repo.author,
          repo.name,
          repo.description || null,
          repo.descriptionZh || null,
          repo.language || null,
          repo.stars || 0,
          repo.currentPeriodStars || 0,
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
    await client?.query('ROLLBACK');
    throw err;
  } finally {
    client?.release();
  }
}

// 建报告表（幂等）
async function ensureReportsSchema() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS analysis_reports (
        id           SERIAL PRIMARY KEY,
        report_type  VARCHAR(10) NOT NULL,
        period_start DATE NOT NULL,
        period_end   DATE NOT NULL,
        status       VARCHAR(10) NOT NULL DEFAULT 'pending',
        retry_count  INT NOT NULL DEFAULT 0,
        content_md   TEXT,
        stats_json   JSONB,
        error_msg    TEXT,
        generated_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (report_type, period_start)
      )
    `);
  } catch (err) {
    console.error('DB: ensureReportsSchema failed:', err.message);
  }
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS repo_summaries (
        id            SERIAL PRIMARY KEY,
        owner         VARCHAR(255) NOT NULL,
        name          VARCHAR(255) NOT NULL,
        summary       TEXT NOT NULL,
        readme_sha    VARCHAR(64),
        summarized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (owner, name)
      )
    `);
    // Index for efficient cache-validation queries
    await p.query(`CREATE INDEX IF NOT EXISTS idx_repo_summaries_owner_name ON repo_summaries (owner, name)`);
  } catch (err) {
    console.error('DB: ensureSummariesSchema failed:', err.message);
  }
}

// 获取或创建报告记录，返回行数据
async function getOrCreateReport(reportType, periodStart, periodEnd) {
  const p = getPool();
  if (!p) return null;
  const res = await p.query(
    `INSERT INTO analysis_reports (report_type, period_start, period_end)
     VALUES ($1, $2, $3)
     ON CONFLICT (report_type, period_start) DO UPDATE SET period_end = EXCLUDED.period_end
     RETURNING *`,
    [reportType, periodStart, periodEnd]
  );
  return res.rows[0];
}

// 标记报告完成
async function markReportDone(id, contentMd, statsJson) {
  const p = getPool();
  if (!p) return;
  await p.query(
    `UPDATE analysis_reports
     SET status = 'done', content_md = $2, stats_json = $3, generated_at = NOW(), error_msg = NULL
     WHERE id = $1`,
    [id, contentMd, JSON.stringify(statsJson)]
  );
}

// 标记报告失败
async function markReportFailed(id, errorMsg) {
  const p = getPool();
  if (!p) return;
  await p.query(
    `UPDATE analysis_reports
     SET status = 'failed', retry_count = retry_count + 1, error_msg = $2
     WHERE id = $1`,
    [id, errorMsg]
  );
}

// 列出所有报告（不含正文）
async function listReports() {
  const p = getPool();
  if (!p) return [];
  const res = await p.query(
    `SELECT id, report_type, period_start, period_end, status, retry_count, generated_at, created_at
     FROM analysis_reports
     ORDER BY period_start DESC, report_type`
  );
  return res.rows;
}

// 获取单份报告（含正文和 stats）
async function getReport(id) {
  const p = getPool();
  if (!p) return null;
  const res = await p.query('SELECT * FROM analysis_reports WHERE id = $1', [id]);
  return res.rows[0] || null;
}

// 查找待重试的失败报告
async function getRetryableReports() {
  const p = getPool();
  if (!p) return [];
  const res = await p.query(
    `SELECT * FROM analysis_reports WHERE status = 'failed' AND retry_count < 3`
  );
  return res.rows;
}

// ─── Repo Summaries (AI-generated README summaries, 30-day cache) ───

// Get cached summary if it's less than maxAgeDays old
async function getCachedSummary(owner, name, maxAgeDays = 30) {
  const p = getPool();
  if (!p) return null;
  const res = await p.query(
    `SELECT summary, readme_sha, summarized_at
     FROM repo_summaries
     WHERE owner = $1 AND name = $2
       AND summarized_at > NOW() - ($3 || ' days')::INTERVAL`,
    [owner, name, String(maxAgeDays)]
  );
  return res.rows[0] || null;
}

// Upsert a repo summary
async function upsertSummary(owner, name, summary, readmeSha) {
  const p = getPool();
  if (!p) return null;
  const res = await p.query(
    `INSERT INTO repo_summaries (owner, name, summary, readme_sha, summarized_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (owner, name)
     DO UPDATE SET summary = EXCLUDED.summary, readme_sha = EXCLUDED.readme_sha, summarized_at = NOW()
     RETURNING *`,
    [owner, name, summary, readmeSha]
  );
  return res.rows[0];
}

// Get summaries for a batch of repos (all at once)
async function getSummariesForRepos(repos, maxAgeDays = 30) {
  const p = getPool();
  if (!p || repos.length === 0) return {};
  const params = [maxAgeDays];
  const placeholders = repos.map((r, i) => {
    params.push(r.owner, r.name);
    return `($${i * 2 + 2}, $${i * 2 + 3})`;
  });
  const res = await p.query(
    `SELECT owner, name, summary, readme_sha
     FROM repo_summaries
     WHERE summarized_at > NOW() - ($1 || ' days')::INTERVAL
       AND (owner, name) IN (${placeholders.join(',')})`,
    params
  );
  const map = {};
  res.rows.forEach(r => { map[`${r.owner}/${r.name}`] = r; });
  return map;
}

// 通用查询（供 analyzer.js 使用）
async function query(sql, params) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not configured');
  return p.query(sql, params);
}

module.exports = {
  testConnection,
  saveTrendingData,
  ensureReportsSchema,
  getOrCreateReport,
  markReportDone,
  markReportFailed,
  listReports,
  getReport,
  getRetryableReports,
  getCachedSummary,
  upsertSummary,
  getSummariesForRepos,
  query
};
