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
  query
};
