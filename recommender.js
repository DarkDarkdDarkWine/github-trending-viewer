const crypto = require('crypto');
const axios = require('axios');
const db = require('./db');
const aiProvider = require('./ai-provider');
const githubClient = require('./github-client');
const { ensureSummaries } = require('./summarizer');
const { getShanghaiDateStr } = require('./src/lib/shanghai-date');

const PROFILE_SAMPLE_LIMIT = 150;
const PROFILE_DESCRIPTION_LIMIT = 180;
const SCORE_BATCH_SIZE = 20;
const SCORE_REASON_LIMIT = 120;

async function refreshInterestProfile() {
  const starredRepos = await githubClient.getStarredRepos();
  if (starredRepos.length === 0) {
    console.warn('[Recommender] No starred repos available for profile generation');
    return { skipped: true, reason: 'no_starred_repos' };
  }

  const profileHash = hashStarredRepos(starredRepos);
  const existing = await db.getUserInterestProfile();
  if (existing?.profile_hash === profileHash && existing?.profile_text) {
    return { success: true, reused: true, profileHash };
  }

  const provider = await aiProvider.getProviderForFeature('recommendation');
  if (!provider) {
    console.warn('[Recommender] No AI provider configured for recommendation');
    return { skipped: true, reason: 'no_ai_provider' };
  }

  const sampledRepos = starredRepos.slice(0, PROFILE_SAMPLE_LIMIT);
  const languageDistribution = countLanguages(starredRepos);
  const prompt = buildProfilePrompt(sampledRepos, starredRepos.length, languageDistribution);

  try {
    const raw = await callAI(provider, prompt, 1200);
    const parsed = parseJsonFromAI(raw);
    const profile = {
      profile_text: String(parsed.profile_text || raw || '').trim(),
      language_distribution: parsed.language_distribution || languageDistribution,
      top_topics: Array.isArray(parsed.top_topics) ? parsed.top_topics.slice(0, 12) : [],
      generated_at: new Date().toISOString(),
      profile_hash: profileHash,
      starred_count: starredRepos.length,
      sampled_starred_count: sampledRepos.length
    };
    if (!profile.profile_text) {
      return { skipped: true, reason: 'empty_profile' };
    }
    await db.setUserInterestProfile(profile);
    return { success: true, profileHash, starredCount: starredRepos.length, sampledStarredCount: sampledRepos.length };
  } catch (err) {
    console.warn('[Recommender] Failed to refresh interest profile:', err.message);
    return { skipped: true, reason: 'ai_failed' };
  }
}

async function scoreTrendingForUser(since = 'daily') {
  let profile = await db.getUserInterestProfile();
  if (!profile?.profile_text || !profile?.profile_hash) {
    const refreshed = await refreshInterestProfile();
    if (refreshed.skipped) return { since, skipped: true, reason: refreshed.reason, scored: 0 };
    profile = await db.getUserInterestProfile();
  }

  const provider = await aiProvider.getProviderForFeature('recommendation');
  if (!provider) return { since, skipped: true, reason: 'no_ai_provider', scored: 0 };

  const repos = await db.getLatestTrendingRepos(since);
  if (repos.length === 0) return { since, skipped: true, reason: 'no_trending_data', scored: 0 };

  const existingScores = await db.getRecommendationScoresForRepos(repos, since);
  const needsScore = repos.filter(repo => {
    const existing = existingScores[repoKey(repo)];
    return existing?.profile_hash !== profile.profile_hash;
  });

  if (needsScore.length === 0) {
    return { since, scored: 0, skippedExisting: repos.length };
  }

  let summaries = new Map();
  try {
    summaries = await ensureSummaries(needsScore.map(repo => ({ owner: repo.owner || repo.author, name: repo.name })));
  } catch (err) {
    console.warn('[Recommender] Failed to load repo summaries:', err.message);
  }

  const records = [];
  let failedBatches = 0;

  for (let i = 0; i < needsScore.length; i += SCORE_BATCH_SIZE) {
    const batch = needsScore.slice(i, i + SCORE_BATCH_SIZE);
    try {
      const prompt = buildScoringPrompt(profile, batch, summaries);
      const raw = await callAI(provider, prompt, 1800);
      const parsed = parseJsonFromAI(raw);
      if (!Array.isArray(parsed)) throw new Error('AI response is not an array');

      for (const item of parsed) {
        const repo = batch[item.index];
        if (!repo) continue;
        records.push({
          owner: repo.owner || repo.author,
          name: repo.name,
          since,
          score_date: getShanghaiDateStr(),
          score: clampScore(item.score),
          reason: trimText(item.reason || '', SCORE_REASON_LIMIT),
          profile_hash: profile.profile_hash
        });
      }
    } catch (err) {
      failedBatches += 1;
      console.warn(`[Recommender] Failed scoring batch for ${since}:`, err.message);
    }
  }

  if (records.length > 0) {
    await db.upsertRecommendationScores(records);
  }

  return {
    since,
    scored: records.length,
    failedBatches,
    skippedExisting: repos.length - needsScore.length
  };
}

async function getScoresForRepos(repos, since = 'daily') {
  try {
    return await db.getRecommendationScoresForRepos(repos, since);
  } catch (err) {
    console.warn('[Recommender] Failed to fetch recommendation scores:', err.message);
    return {};
  }
}

function buildProfilePrompt(repos, totalCount, languageDistribution) {
  const repoLines = repos.map((repo, index) => {
    const desc = trimText(repo.description || '', PROFILE_DESCRIPTION_LIMIT);
    const language = repo.language || 'Unknown';
    return `${index + 1}. ${repo.full_name || `${repo.owner}/${repo.name}`} [${language}] ${desc}`;
  }).join('\n');

  return `你是一位开发者兴趣画像分析助手。请根据用户 Star 过的 GitHub 仓库生成中文兴趣画像。

约束：
- 用户一共有 ${totalCount} 个 Star 仓库，本次只抽取最近更新的 ${repos.length} 个控制 token。
- 语言分布为：${JSON.stringify(languageDistribution)}
- 输出严格 JSON，不要 Markdown，不要解释。
- JSON 格式：{"profile_text":"3-5句中文画像","top_topics":["主题1","主题2"],"language_distribution":{...}}

Star 仓库样本：
${repoLines}`;
}

function buildScoringPrompt(profile, repos, summaries) {
  const repoLines = repos.map((repo, index) => {
    const key = repoKey(repo);
    const summary = summaries.get(key);
    const desc = trimText(summary || repo.description_zh || repo.description || '', 420);
    const language = repo.language || 'Unknown';
    return `${index}. ${key} [${language}] rank=${repo.rank || '-'} stars=${repo.stars || 0} period_stars=${repo.period_stars || repo.currentPeriodStars || 0}\n简介：${desc}`;
  }).join('\n\n');

  return `你是一位开源项目推荐排序助手。请根据用户兴趣画像，为 GitHub Trending 项目打 0-100 匹配分。

用户兴趣画像：
${profile.profile_text}

评分要求：
- 90-100：高度贴合用户长期兴趣，值得优先查看
- 70-89：明显相关，但可能不是核心兴趣
- 50-69：有部分相关点
- 0-49：弱相关或不相关
- reason 用一句中文说明，最多 30 个汉字
- 输出严格 JSON 数组，不要 Markdown，不要解释
- JSON 格式：[{"index":0,"score":88,"reason":"匹配 AI 工程工具兴趣"}]

待评分项目：
${repoLines}`;
}

async function callAI(provider, prompt, maxTokens) {
  const { preset, apiKey, model } = provider;
  const response = await axios.post(
    `${preset.baseUrl}${preset.chatPath}`,
    {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );
  return (response.data.choices?.[0]?.message?.content || '').trim();
}

function parseJsonFromAI(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) throw new Error('Empty AI response');
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const firstObject = withoutFence.indexOf('{');
    const firstArray = withoutFence.indexOf('[');
    const start = [firstObject, firstArray].filter(i => i >= 0).sort((a, b) => a - b)[0];
    if (start === undefined) throw new Error('AI response is not JSON');
    const endChar = withoutFence[start] === '[' ? ']' : '}';
    const end = withoutFence.lastIndexOf(endChar);
    if (end <= start) throw new Error('AI response is not JSON');
    return JSON.parse(withoutFence.slice(start, end + 1));
  }
}

function hashStarredRepos(repos) {
  const names = repos
    .map(repo => repo.full_name || `${repo.owner}/${repo.name}`)
    .filter(Boolean)
    .sort();
  return crypto.createHash('sha1').update(names.join('\n')).digest('hex');
}

function countLanguages(repos) {
  return repos.reduce((acc, repo) => {
    const language = repo.language || 'Unknown';
    acc[language] = (acc[language] || 0) + 1;
    return acc;
  }, {});
}

function clampScore(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function repoKey(repo) {
  return `${repo.owner || repo.author}/${repo.name}`;
}

function trimText(text, maxLength) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

module.exports = {
  refreshInterestProfile,
  scoreTrendingForUser,
  getScoresForRepos,
  hashStarredRepos,
  parseJsonFromAI
};
