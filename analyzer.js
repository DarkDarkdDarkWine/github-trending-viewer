const axios = require('axios');
const db = require('./db');

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

  return {
    period_start: periodStart,
    period_end: periodEnd,
    total_appearances: totalApps,
    unique_repos: Object.keys(repoMap).length,
    language_distribution,
    top_repos,
    daily_counts
  };
}

// 批量翻译描述（一次 API 调用，按编号返回）
async function translateDescriptions(texts) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || texts.length === 0) return texts;

  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  try {
    const response = await axios.post(
      'https://api.deepseek.com/chat/completions',
      {
        model: 'deepseek-chat',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `将以下英文按原编号翻译成中文，只返回"编号. 译文"格式，不要任何解释：\n${numbered}`
        }]
      },
      {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );
    const raw = response.data.choices[0].message.content.trim();
    const result = [...texts]; // fallback to originals
    raw.split('\n').forEach(line => {
      const m = line.match(/^(\d+)\.\s+(.+)/);
      if (m) {
        const idx = parseInt(m[1]) - 1;
        if (idx >= 0 && idx < result.length) result[idx] = m[2].trim();
      }
    });
    return result;
  } catch (err) {
    console.warn('Batch translation failed:', err.message);
    return texts;
  }
}

// 调用 DeepSeek 生成分析文本
async function callDeepSeek(stats, reportType) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

  const label = reportType === 'weekly' ? '周' : '月';
  const statsText = [
    `时间范围：${stats.period_start} 至 ${stats.period_end}`,
    `总上榜次数：${stats.total_appearances}，独立项目数：${stats.unique_repos}`,
    '',
    'Top 15 最活跃项目：',
    ...stats.top_repos.map((r, i) =>
      `${i + 1}. ${r.author}/${r.name}（${r.language || '未知'}）- 上榜 ${r.appearances} 次，最高排名第 ${r.peak_rank} 名，平均新增 ${r.avg_period_stars} stars`
    ),
    '',
    '编程语言分布（Top 5）：',
    ...stats.language_distribution.slice(0, 5).map(l =>
      `- ${l.language}: ${l.count} 次出现 (${l.pct}%)`
    )
  ].join('\n');

  const response = await axios.post(
    'https://api.deepseek.com/chat/completions',
    {
      model: 'deepseek-chat',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `你是一位开源技术趋势分析师。以下是 GitHub Trending ${label}报告（${stats.period_start} 至 ${stats.period_end}）的统计数据：\n\n${statsText}\n\n请撰写一份深度分析报告，要求：\n1. 结合近期技术圈背景（框架发布、公司动态、热点事件等）解释热点成因\n2. 分析社区注意力的变化方向和演进轨迹\n3. 用 Markdown 格式输出，可包含表格，不要包含代码块\n4. 报告结构：核心洞察（3-5条）→ 详细分析 → 趋势展望\n5. 语言：中文，专业但易读`
      }]
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    }
  );

  return response.data.choices[0].message.content.trim();
}

// 生成单份报告的完整流程
async function generateOneReport(report) {
  console.log(`Generating ${report.report_type} report: ${report.period_start} ~ ${report.period_end}`);
  try {
    const stats = await computeStats(report.period_start, report.period_end);
    if (!stats) {
      await db.markReportFailed(report.id, 'No data found for this period');
      return { id: report.id, success: false, reason: 'no_data' };
    }

    const contentMd = await callDeepSeek(stats, report.report_type);
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
