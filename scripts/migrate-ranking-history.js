const fs = require('fs').promises;
const path = require('path');
const db = require('../db');

const DEFAULT_HISTORY_FILE = path.join(__dirname, '..', 'data', 'ranking-history.json');

async function migrateRankingHistory(options = {}) {
  const historyFile = options.historyFile || process.env.RANKING_HISTORY_FILE || DEFAULT_HISTORY_FILE;
  const history = await readHistory(historyFile);
  const records = Array.isArray(history.records) ? history.records : [];
  let migrated = 0;

  for (const record of records) {
    if (!record.since || !record.timestamp || !Array.isArray(record.repos)) continue;

    const collectDate = record.timestamp.split('T')[0];
    const recordId = await upsertRecord(record.since, collectDate, record.timestamp);
    await replaceRepos(recordId, record.repos);
    migrated += 1;
  }

  return { migrated, historyFile };
}

async function readHistory(historyFile) {
  try {
    const raw = await fs.readFile(historyFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return { records: [] };
    throw err;
  }
}

async function upsertRecord(since, collectDate, timestamp) {
  const res = await db.query(
    `INSERT INTO trending_records (since, collected_at, collect_date)
     VALUES ($1, $2, $3)
     ON CONFLICT (since, collect_date)
     DO UPDATE SET collected_at = EXCLUDED.collected_at
     RETURNING id`,
    [since, timestamp, collectDate]
  );
  return res.rows[0].id;
}

async function replaceRepos(recordId, repos) {
  await db.query('DELETE FROM trending_repos WHERE record_id = $1', [recordId]);
  if (repos.length === 0) return;

  const params = [];
  const values = repos.map((repo, index) => {
    const base = index * 8;
    params.push(
      recordId,
      repo.rank || index + 1,
      repo.author,
      repo.name,
      repo.stars || 0,
      repo.currentPeriodStars || 0,
      repo.description || null,
      repo.language || null
    );
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
  });

  await db.query(
    `INSERT INTO trending_repos
       (record_id, rank, author, name, stars, period_stars, description, language)
     VALUES ${values.join(',')}`,
    params
  );
}

if (require.main === module) {
  migrateRankingHistory()
    .then(result => {
      console.log(`已迁移 ${result.migrated} 条历史记录`);
    })
    .catch(err => {
      console.error('迁移 ranking history 失败:', err.message);
      process.exitCode = 1;
    });
}

module.exports = { migrateRankingHistory };
