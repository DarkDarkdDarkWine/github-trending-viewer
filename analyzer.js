const db = require('./db');
const aiProvider = require('./ai-provider');
const { ensureSummaries } = require('./summarizer');

// 获取上海时区的当前日期字符串 (YYYY-MM-DD)
function getShanghaiDateStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

// 根据上海时区的今天，计算应该生成哪些报告
function getReportsDueToday() {
  const todayStr = getShanghaiDateStr();
  const today = new Date(todayStr);
  const dayOfWeek = today.getDay(); // 0=Sunday, 1=Monday
  const dayOfMonth = today.getDate();

  const due = [];

  // 每天生成昨天的日报
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  due.push({
    report_type: 'daily',
    period_start: yesterdayStr,
    period_end: yesterdayStr
  });

  // 周一生成上周周报
  if (dayOfWeek === 1) {
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - 1);
    const lastMonday = new Date(today);
    lastMonday.setDate(today.getDate() - 7);

    due.push({
      report_type: 'weekly',
      period_start: lastMonday.toISOString().split('T')[0],
      period_end: lastSunday.toISOString().split('T')[0]
    });
  }

  // 每月1日生成上月月报
  if (dayOfMonth === 1) {
    const lastDayOfLastMonth = new Date(today);
    lastDayOfLastMonth.setDate(0);
    const firstDayOfLastMonth = new Date(lastDayOfLastMonth.getFullYear(), lastDayOfLastMonth.getMonth(), 1);

    due.push({
      report_type: 'monthly',
      period_start: firstDayOfLastMonth.toISOString().split('T')[0],
      period_end: lastDayOfLastMonth.toISOString().split('T')[0]
    });
  }

  return due;
}

// 从 PostgreSQL 聚合统计数据
async function computeStats(periodStart, periodEnd) {
  const res = await db.query(
    `SELECT r.since, r.collect_date, rp.rank, rp.author, rp.name, rp.language, rp.stars, rp.period_stars, rp.description, rp.description_zh
     FROM trending_records r
     JOIN trending_repos rp ON r.id = rp.record_id
     WHERE r.collect_date >= $1 AND r.collect_date <= $2
     ORDER BY r.collect_date, r.since, rp.rank`,
    [periodStart, periodEnd]
  );

  const rows = res.rows;
  if (rows.length === 0) return null;

  const repoMap = {};
  const dailyMap = {};

  rows.forEach(row => {
    const key = `${row.author}/${row.name}`;
    const dateStr = row.collect_date instanceof Date
      ? row.collect_date.toISOString().split('T')[0]
      : String(row.collect_date).split('T')[0];

    if (!repoMap[key]) {
      repoMap[key] = {
        author: row.author,
        name: row.name,
        language: row.language,
        description: row.description_zh || row.description || '',
        appearances: 0,
        peak_rank: row.rank,
        total_period_stars: 0,
        first_seen: dateStr,
        last_seen: dateStr
      };
    } else if (!repoMap[key].description) {
      repoMap[key].description = row.description_zh || row.description || '';
    }
    const r = repoMap[key];
    r.appearances++;
    r.peak_rank = Math.min(r.peak_rank, row.rank);
    r.total_period_stars += row.period_stars || 0;
    if (dateStr < r.first_seen) r.first_seen = dateStr;
    if (dateStr > r.last_seen) r.last_seen = dateStr;

    if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, daily: 0, weekly: 0, monthly: 0 };
    if (row.since === 'daily') dailyMap[dateStr].daily++;
    else if (row.since === 'weekly') dailyMap[dateStr].weekly++;
    else if (row.since === 'monthly') dailyMap[dateStr].monthly++;
  });

  // 语言分布
  const langMap = {};
  Object.values(repoMap).forEach(r => {
    const lang = r.language || 'Unknown';
    langMap[lang] = (langMap[lang] || 0) + r.appearances;
  });
  const totalApps = rows.length;
  const language_distribution = Object.entries(langMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([language, count]) => ({
      language,
      count,
      pct: Math.round(count / totalApps * 1000) / 10
    }));

  // Top repos
  const top_repos = Object.values(repoMap)
    .sort((a, b) => b.appearances - a.appearances || a.peak_rank - b.peak_rank)
    .slice(0, 15)
    .map(r => ({
      author: r.author,
      name: r.name,
      language: r.language || '',
      description: r.description || '',
      appearances: r.appearances,
      peak_rank: r.peak_rank,
      avg_period_stars: Math.round(r.total_period_stars / r.appearances),
      first_seen: r.first_seen,
      last_seen: r.last_seen
    }));

  const daily_counts = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // 翻译 top_repos 的描述（只翻译英文内容）
  const descs = top_repos.map(r => r.description);
  const translated = await translateDescriptions(descs.filter(Boolean).length > 0 ? descs : []);
  top_repos.forEach((r, i) => { if (translated[i]) r.description = translated[i]; });

  // 获取 AI 摘要（优先使用缓存，避免重复生成）
  let summaries = new Map();
  try {
    const topReposForSummary = top_repos.map(r => ({ owner: r.author, name: r.name }));
    summaries = await ensureSummaries(topReposForSummary);
  } catch (err) {
    console.warn('Failed to fetch summaries for report:', err.message);
  }

  // 将摘要注入 top_repos
  top_repos.forEach(r => {
    const key = `${r.author}/${r.name}`;
    const summary = summaries.get(key);
    if (summary) {
      r.ai_summary = summary;
    }
  });

  return {
    period_start: periodStart,
    period_end: periodEnd,
    total_appearances: totalApps,
    unique_repos: Object.keys(repoMap).length,
    language_distribution,
    top_repos,
    daily_counts,
    summaries: Object.fromEntries(summaries)
  };
}

// 批量翻译描述（委托给 ai-provider 模块）
async function translateDescriptions(texts) {
  if (texts.length === 0) return texts;
  return aiProvider.translateBatch(texts);
}

// 生成分析报告（委托给 ai-provider 模块，支持联网搜索）
async function callAI(stats, reportType) {
  return aiProvider.generateReport(stats, reportType);
}

// ─── Daily report: per-repo AI summaries ──────────────────────────────────

async function generateDailyReport(report) {
  console.log(`Generating daily report: ${report.period_start}`);
  const periodDate = report.period_start;

  // Get the daily trending repos from DB
  const res = await db.query(
    `SELECT rp.author, rp.name, rp.description, rp.language, rp.stars, rp.period_stars, rp.rank
     FROM trending_repos rp
     JOIN trending_records r ON r.id = rp.record_id
     WHERE r.collect_date = $1 AND r.since = 'daily'
     ORDER BY rp.rank`,
    [periodDate]
  );

  if (res.rows.length === 0) {
    await db.markReportFailed(report.id, 'No trending data for this date');
    return { id: report.id, success: false, reason: 'no_data' };
  }

  const repos = res.rows.map(r => ({ owner: r.author, name: r.name }));

  // Generate AI summaries (uses 30-day cache)
  const summaries = await ensureSummaries(repos);

  // Build report content
  // Format date as YYYY-MM-DD regardless of input format (Date object or string)
  const displayDate = new Date(periodDate).toISOString().split('T')[0];

  const lines = [
    `# 📅 GitHub Trending 日报`,
    ``,
    `**日期**：${displayDate}`,
    ``,
    `---`,
    ``
  ];

  res.rows.forEach((r) => {
    const key = `${r.author}/${r.name}`;
    const summary = summaries.get(key) || '';
    const lang = r.language ? ` \`${r.language}\`` : '';

    lines.push(`## ${r.rank}. [${r.author}/${r.name}](https://github.com/${r.author}/${r.name})${lang}`);
    lines.push('');
    lines.push(`⭐ ${Number(r.stars).toLocaleString()} 总星标 · 📈 +${Number(r.period_stars).toLocaleString()} 本日新增`);
    lines.push('');

    if (r.description) {
      lines.push(`> ${r.description}`);
      lines.push('');
    }

    if (summary) {
      lines.push(`📝 ${summary}`);
    } else {
      lines.push(`*暂无 AI 简介*`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  const contentMd = lines.join('\n');

  const stats = {
    period_start: periodDate,
    period_end: periodDate,
    total_appearances: res.rows.length,
    unique_repos: res.rows.length,
    top_repos: res.rows.map(r => ({
      author: r.author,
      name: r.name,
      language: r.language || '',
      description: summaries.get(`${r.author}/${r.name}`) || r.description || '',
      appearances: 1,
      peak_rank: r.rank,
      avg_period_stars: Number(r.period_stars) || 0
    })),
    language_distribution: [],
    daily_counts: []
  };

  await db.markReportDone(report.id, contentMd, stats);
  console.log(`Daily report ${report.id} done (${res.rows.length} repos, ${summaries.size} summaries)`);
  return { id: report.id, success: true };
}

// 生成单份报告的完整流程
async function generateOneReport(report) {
  console.log(`Generating ${report.report_type} report: ${report.period_start} ~ ${report.period_end}`);

  if (report.report_type === 'daily') {
    return generateDailyReport(report);
  }

  try {
    const stats = await computeStats(report.period_start, report.period_end);
    if (!stats) {
      await db.markReportFailed(report.id, 'No data found for this period');
      return { id: report.id, success: false, reason: 'no_data' };
    }

    const contentMd = await callAI(stats, report.report_type);
    await db.markReportDone(report.id, contentMd, stats);
    console.log(`Report ${report.id} done`);
    return { id: report.id, success: true };
  } catch (err) {
    console.error(`Report ${report.id} failed:`, err.message);
    await db.markReportFailed(report.id, err.message);
    return { id: report.id, success: false, reason: err.message };
  }
}

// 主入口：检查今天应生成哪些报告，依次执行
async function runScheduledReports() {
  const due = getReportsDueToday();

  // 找出需要重试的失败报告
  const retryable = await db.getRetryableReports();

  // 合并：today's due + retryable
  const toProcess = [];
  for (const d of due) {
    const report = await db.getOrCreateReport(d.report_type, d.period_start, d.period_end);
    if (report && report.status !== 'done') {
      toProcess.push(report);
    }
  }
  for (const r of retryable) {
    if (!toProcess.find(p => p.id === r.id)) {
      toProcess.push(r);
    }
  }

  const results = [];
  for (const report of toProcess) {
    const result = await generateOneReport(report);
    results.push(result);
  }

  return { due: due.length, retryable: retryable.length, processed: results };
}

module.exports = { runScheduledReports, computeStats, getReportsDueToday };
