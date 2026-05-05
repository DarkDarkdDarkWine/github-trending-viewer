/**
 * summarizer.js — AI-powered README summarization with 30-day cache
 *
 * For each repo, fetches the README via GitHub API, feeds it to the
 * configured AI provider for a Chinese summary, and caches the result
 * in PostgreSQL for 30 days.  When a repo has already been summarized
 * recently its cached summary is reused to save tokens.
 */

const db = require('./db');
const aiProvider = require('./ai-provider');
const githubClient = require('./github-client');

const README_MAX_CHARS = 3000;
const SUMMARY_CACHE_DAYS = 30;
const CONCURRENCY = 3; // simultaneous AI calls

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Ensure every repo in `repos` (array of {owner, name}) has a fresh summary.
 * Returns a Map keyed by "owner/name" → summary string.
 */
async function ensureSummaries(repos) {
  if (repos.length === 0) return new Map();

  // 1. Check cache
  const cached = await db.getSummariesForRepos(repos, SUMMARY_CACHE_DAYS);
  const results = new Map();
  const needsFetch = [];

  for (const repo of repos) {
    const key = `${repo.owner}/${repo.name}`;
    if (cached[key]) {
      results.set(key, cached[key].summary);
    } else {
      needsFetch.push(repo);
    }
  }

  if (needsFetch.length === 0) return results;

  console.log(`[Summarizer] ${needsFetch.length}/${repos.length} repos need fresh summaries`);

  // 2. Fetch README + AI summarize with concurrency limit
  for (let i = 0; i < needsFetch.length; i += CONCURRENCY) {
    const batch = needsFetch.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(repo => summarizeOneRepo(repo.owner, repo.name))
    );

    batchResults.forEach((result, j) => {
      const repo = batch[j];
      const key = `${repo.owner}/${repo.name}`;
      if (result.status === 'fulfilled' && result.value) {
        results.set(key, result.value);
      } else {
        const err = result.status === 'rejected' ? result.reason?.message : 'unknown';
        console.warn(`[Summarizer] Failed for ${key}: ${err}`);
        results.set(key, ''); // empty string = no summary available
      }
    });
  }

  return results;
}

// ─── Internal ──────────────────────────────────────────────────────────────

async function summarizeOneRepo(owner, name) {
  // Fetch README
  let readmeText, readmeSha;
  try {
    const readme = await githubClient.fetchRepoReadme(owner, name);
    if (!readme) {
      console.warn(`[Summarizer] No README found for ${owner}/${name}`);
      return '';
    }
    readmeText = readme.text;
    readmeSha = readme.sha;
  } catch (err) {
    console.warn(`[Summarizer] README fetch failed for ${owner}/${name}: ${err.message}`);
    return '';
  }

  // Truncate to control token cost
  const truncated = readmeText.length > README_MAX_CHARS
    ? readmeText.substring(0, README_MAX_CHARS) + '\n\n...(truncated)'
    : readmeText;

  // Call AI
  const summary = await callAIForSummary(owner, name, truncated);
  if (!summary) return '';

  // Cache
  try {
    await db.upsertSummary(owner, name, summary, readmeSha);
  } catch (err) {
    console.warn(`[Summarizer] Failed to cache summary for ${owner}/${name}: ${err.message}`);
  }

  return summary;
}

async function callAIForSummary(owner, name, readmeText) {
  const provider = await aiProvider.getProviderForFeature('report');
  if (!provider) {
    console.warn('[Summarizer] No AI provider configured for summarization');
    return '';
  }

  const { preset, apiKey, model } = provider;

  const prompt = `根据以下 GitHub 项目的 README，用一句中文概括该项目（不超过80字）：\n\n项目 ${owner}/${name} 的 README：\n${readmeText}\n\n一句话概括：`;

  try {
    const response = await require('axios').post(
      `${preset.baseUrl}${preset.chatPath}`,
      {
        model,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
    const content = response.data.choices?.[0]?.message?.content?.trim();
    return content || '';
  } catch (err) {
    console.warn(`[Summarizer] AI call failed for ${owner}/${name}: ${err.message}`);
    return '';
  }
}

module.exports = { ensureSummaries };
