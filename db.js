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

  let client;
  try {
    client = await p.connect();
    await client.query('BEGIN');

    // Upsert trending_records
    const upsertResult = await client.query(
      `INSERT INTO trending_records (since, language, collected_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (since, DATE(collected_at))
       DO UPDATE SET collected_at = NOW()
       RETURNING id`,
      [since, language]
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
          repo.rank,
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

module.exports = { testConnection, saveTrendingData };
