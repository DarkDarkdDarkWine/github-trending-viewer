const express = require('express');
const rankingHistory = require('../services/ranking-history');
const trendingCache = require('../services/trending-cache');
const { scrapeTrending } = require('../services/trending-scraper');
const recommender = require('../../recommender');

const router = express.Router();

router.get('/api/trending', async (req, res) => {
  const { since = 'daily' } = req.query;
  const personalize = req.query.personalize === '1' || req.query.personalize === 'true';

  try {
    const cached = trendingCache.get(since);
    if (cached) {
      const data = personalize
        ? await withRecommendationScores(cached.data, since)
        : cached.data;
      return res.json({
        success: true,
        data,
        params: { since, personalize }
      });
    }

    console.log(`Fetching trending repos: since=${since}`);
    const repos = await scrapeTrending(since);
    const changes = await rankingHistory.getChanges(repos, since);
    const reposWithChanges = repos.map((repo, index) => ({
      ...repo,
      rankingChange: changes[index]
    }));

    trendingCache.set(since, reposWithChanges);
    rankingHistory.update(repos, since).catch(err => {
      console.error('Failed to update ranking history:', err.message);
    });

    const data = personalize
      ? await withRecommendationScores(reposWithChanges, since)
      : reposWithChanges;

    res.json({
      success: true,
      data,
      params: { since, personalize }
    });
  } catch (error) {
    const stale = trendingCache.getLastSuccess(since);
    if (stale) {
      const data = personalize
        ? await withRecommendationScores(stale.data, since)
        : stale.data;
      return res.json({
        success: true,
        data,
        params: { since, personalize },
        meta: { stale: true, lastSuccess: stale.lastSuccess }
      });
    }

    console.error('Error fetching trending repos:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'scrape_failed'
    });
  }
});

async function withRecommendationScores(repos, since) {
  const scores = await recommender.getScoresForRepos(repos, since);
  return repos.map(repo => {
    const score = scores[`${repo.author}/${repo.name}`];
    if (!score || typeof score.score !== 'number') return repo;
    return {
      ...repo,
      matchScore: score.score,
      matchReason: score.reason || ''
    };
  });
}

module.exports = router;
