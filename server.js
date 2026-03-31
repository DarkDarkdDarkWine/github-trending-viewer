require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const db = require('./db');
const { runScheduledReports } = require('./analyzer');
const aiProvider = require('./ai-provider');

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const HISTORY_FILE = path.join(__dirname, 'data', 'ranking-history.json');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure data directory exists
async function ensureDataDir() {
  const dataDir = path.join(__dirname, 'data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// Load ranking history
async function loadRankingHistory() {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { records: [] };
  }
}

// Save ranking history
async function saveRankingHistory(history) {
  await ensureDataDir();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Update ranking history - record last result of each period per day
async function updateRankingHistory(repos, since) {
  const history = await loadRankingHistory();
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const key = `${today}-${since}`;

  const record = {
    timestamp: now,
    since,
    key,
    repos: repos.map((repo, index) => ({
      rank: index + 1,
      author: repo.author,
      name: repo.name,
      stars: repo.stars,
      currentPeriodStars: repo.currentPeriodStars
    }))
  };

  history.records = history.records || [];
  const existingIndex = history.records.findIndex(r => r.key === key);
  if (existingIndex >= 0) {
    history.records[existingIndex] = record;
  } else {
    history.records.unshift(record);
  }

  // 只保留最近30天的记录
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  history.records = history.records.filter(r => r.timestamp >= thirtyDaysAgo.toISOString());

  await saveRankingHistory(history);
}

// Get ranking changes - compare with last record from previous day
async function getRankingChanges(repos, since) {
  const history = await loadRankingHistory();
  const today = new Date().toISOString().split('T')[0];

  // 找到今天之前的最近一条同周期记录
  const previousRecord = history.records
    .filter(r => r.since === since)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .find(r => !r.timestamp.startsWith(today));

  if (!previousRecord) {
    return repos.map(() => ({ change: 0, isNew: true }));
  }

  return repos.map((repo, currentRank) => {
    const prevData = previousRecord.repos.find(
      r => r.author === repo.author && r.name === repo.name
    );

    if (!prevData) {
      return { change: 0, isNew: true };
    }

    const change = prevData.rank - (currentRank + 1);
    return {
      change,
      isNew: false,
      previousRank: prevData.rank
    };
  });
}

// Scrape GitHub trending page
async function scrapeTrending(since = 'daily') {
  try {
    const url = `https://github.com/trending?since=${since}`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const repos = [];

    $('article.Box-row').each((index, element) => {
      const $elem = $(element);

      const repoLink = $elem.find('h2 a').attr('href');
      if (!repoLink) return;

      const [, author, name] = repoLink.split('/');

      const description = $elem.find('p.col-9').text().trim();
      const language = $elem.find('[itemprop="programmingLanguage"]').text().trim();

      const starsText = $elem.find('a[href$="/stargazers"]').text().trim();
      const stars = parseNumber(starsText);

      const forksText = $elem.find('a[href$="/forks"]').text().trim();
      const forks = parseNumber(forksText);

      const starsSpan = $elem.find('span.float-sm-right').text().trim();
      const currentPeriodStars = parseNumber(starsSpan.split(' ')[0]);

      const builtBy = [];
      $elem.find('img[alt^="@"]').each((i, img) => {
        const username = $(img).attr('alt').replace('@', '');
        builtBy.push({
          username,
          avatar: $(img).attr('src'),
          url: `https://github.com/${username}`
        });
      });

      repos.push({
        author,
        name,
        url: `https://github.com${repoLink}`,
        description: description || '',
        descriptionZh: '',
        language: language || '',
        stars,
        forks,
        currentPeriodStars,
        builtBy
      });
    });

    // 结构校验：如果抓取结果为空，说明 GitHub 页面结构可能已变更
    if (repos.length === 0) {
      throw new Error('Scraping returned 0 repos — GitHub page structure may have changed');
    }

    repos.sort((a, b) => b.currentPeriodStars - a.currentPeriodStars);
    repos.splice(20);

    return repos;
  } catch (error) {
    console.error('Error scraping GitHub trending:', error.message);
    throw error;
  }
}

// Parse number from string (e.g., "1.2k" -> 1200)
function parseNumber(str) {
  if (!str) return 0;
  str = str.replace(/,/g, '').trim();

  const multipliers = {
    'k': 1000,
    'm': 1000000
  };

  const match = str.match(/([\d.]+)([km])?/i);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const multiplier = match[2] ? multipliers[match[2].toLowerCase()] : 1;

  return Math.round(num * multiplier);
}

// Translate description to Chinese using configured AI provider
async function translateToChinese(text) {
  if (!text || text.length < 3) return text;
  return aiProvider.translate(text);
}

// Check if user starred a repository
async function checkStarred(owner, repo) {
  if (!GITHUB_TOKEN) {
    return null;
  }

  try {
    await axios.get(`https://api.github.com/user/starred/${owner}/${repo}`, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    return true;
  } catch (error) {
    if (error.response?.status === 404) {
      return false;
    }
    console.error(`Error checking star status for ${owner}/${repo}:`, error.message);
    return null;
  }
}

// API endpoint to get trending repositories
app.get('/api/trending', async (req, res) => {
  try {
    const { since = 'daily' } = req.query;

    console.log(`Fetching trending repos: since=${since}`);

    const repos = await scrapeTrending(since);
    const changes = await getRankingChanges(repos, since);

    const reposWithChanges = repos.map((repo, index) => ({
      ...repo,
      rankingChange: changes[index]
    }));

    updateRankingHistory(repos, since).catch(err => {
      console.error('Failed to update ranking history:', err);
    });

    db.saveTrendingData(repos, since).catch(err => {
      console.error('Failed to save trending data to DB:', err);
    });

    res.json({
      success: true,
      data: reposWithChanges,
      params: { since }
    });
  } catch (error) {
    console.error('Error fetching trending repos:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint to check if repos are starred
app.post('/api/check-starred', async (req, res) => {
  try {
    const { repos } = req.body;

    if (!GITHUB_TOKEN) {
      return res.json({
        success: true,
        data: repos.map(r => ({ owner: r.owner, name: r.name, starred: null })),
        message: 'GitHub token not configured'
      });
    }

    const starredStatus = await Promise.all(
      repos.map(async ({ owner, name }) => {
        const starred = await checkStarred(owner, name);
        return { owner, name, starred };
      })
    );

    res.json({
      success: true,
      data: starredStatus
    });
  } catch (error) {
    console.error('Error checking starred status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get user's starred repositories, sorted by recently updated
async function getStarredRepos() {
  if (!GITHUB_TOKEN) return [];

  try {
    const response = await axios.get('https://api.github.com/user/starred', {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      },
      params: { per_page: 100, sort: 'updated', direction: 'desc' }
    });
    return response.data.map(repo => ({
      owner: repo.owner.login,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      descriptionZh: repo.description,
      language: repo.language,
      url: repo.html_url,
      updated_at: repo.updated_at
    }));
  } catch (error) {
    console.error('Error fetching starred repos:', error.message);
    return [];
  }
}

// Get recent activity for a repo — always fetch both releases and commits
async function getRepoActivity(owner, repo) {
  const activities = [];

  const [releasesRes, commitsRes] = await Promise.allSettled([
    axios.get(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}` },
      params: { per_page: 5 }
    }),
    axios.get(`https://api.github.com/repos/${owner}/${repo}/commits`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}` },
      params: { per_page: 5 }
    })
  ]);

  if (releasesRes.status === 'fulfilled') {
    for (const release of releasesRes.value.data || []) {
      activities.push({
        type: 'ReleaseEvent',
        repo: `${owner}/${repo}`,
        actor: release.author?.login || owner,
        avatar: release.author?.avatar_url || '',
        created_at: release.published_at || release.created_at,
        details: { tag: release.tag_name, name: release.name, body: release.body }
      });
    }
  }

  if (commitsRes.status === 'fulfilled') {
    for (const commit of commitsRes.value.data || []) {
      activities.push({
        type: 'PushEvent',
        repo: `${owner}/${repo}`,
        actor: commit.author?.login || commit.commit?.author?.name || 'unknown',
        avatar: commit.author?.avatar_url || '',
        created_at: commit.commit?.author?.date,
        details: { message: commit.commit?.message?.split('\n')[0], sha: commit.sha?.substring(0, 7) }
      });
    }
  }

  return activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Get starred repos activity
app.get('/api/starred-activity', async (req, res) => {
  try {
    if (!GITHUB_TOKEN) {
      return res.json({ success: false, message: 'GitHub token not configured' });
    }

    const repos = await getStarredRepos();
    if (repos.length === 0) {
      return res.json({ success: true, data: [], message: 'No starred repos found' });
    }

    // 取前 30 个最近有更新的仓库检查动态（sort=updated 已保证顺序）
    const activityPromises = repos.slice(0, 30).map(async repo => {
      const events = await getRepoActivity(repo.owner, repo.name);
      return { repo, events: events.slice(0, 5) };
    });

    const results = await Promise.all(activityPromises);

    const allEvents = [];
    results.forEach(({ repo, events }) => {
      events.forEach(event => {
        allEvents.push({ ...event, repo_info: repo });
      });
    });

    allEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, data: allEvents.slice(0, 50) });
  } catch (error) {
    console.error('Error fetching starred activity:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SSE endpoint: translate descriptions, stream results as they complete
app.post('/api/translate', async (req, res) => {
  const { texts } = req.body;
  if (!texts || texts.length === 0) {
    return res.status(400).json({ error: 'No texts provided' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  for (const { index, text } of texts) {
    const translation = await translateToChinese(text);
    res.write(`data: ${JSON.stringify({ index, translation })}\n\n`);
  }

  res.end();
});

// 触发今日应生成的报告（cron 调用：每周一 + 每月1日）
app.get('/api/generate-reports', async (req, res) => {
  try {
    const result = await runScheduledReports();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error generating reports:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 列出所有报告（不含正文）
app.get('/api/reports', async (req, res) => {
  try {
    const reports = await db.listReports();
    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取单份报告详情（含正文和 stats）
app.get('/api/reports/:id', async (req, res) => {
  try {
    const report = await db.getReport(parseInt(req.params.id));
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── AI Provider 管理 API ────────────────────────────────────────────────────

// 获取所有供应商（预设 + 配置状态）
app.get('/api/ai-providers', async (req, res) => {
  try {
    const presets = await aiProvider.getPresets();
    res.json({ success: true, data: presets });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 添加/更新供应商
app.post('/api/ai-providers', async (req, res) => {
  try {
    const { id, apiKey } = req.body;
    if (!id || !apiKey) return res.status(400).json({ success: false, error: 'id and apiKey required' });
    const result = await aiProvider.upsertProvider(id, apiKey);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除供应商
app.delete('/api/ai-providers/:id', async (req, res) => {
  try {
    await aiProvider.removeProvider(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 测试供应商连通性
app.post('/api/ai-providers/test', async (req, res) => {
  try {
    const { id, apiKey, model } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    const result = await aiProvider.testProvider(id, apiKey, model);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 拉取供应商可用模型列表
app.post('/api/ai-providers/models', async (req, res) => {
  try {
    const { id, apiKey } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    const models = await aiProvider.fetchModels(id, apiKey);
    res.json({ success: true, data: models });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新供应商模型选择
app.put('/api/ai-providers/:id/models', async (req, res) => {
  try {
    const { selectedModels } = req.body;
    if (!selectedModels) return res.status(400).json({ success: false, error: 'selectedModels required' });
    const result = await aiProvider.updateModels(req.params.id, selectedModels);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  if (!GITHUB_TOKEN) {
    console.warn('⚠️  GITHUB_TOKEN not set. Star status checking will be disabled.');
  }
  await db.ensureReportsSchema();
});
