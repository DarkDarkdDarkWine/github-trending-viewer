const express = require('express');
const rankingHistory = require('../services/ranking-history');
const trendingCache = require('../services/trending-cache');
const { scrapeTrending } = require('../services/trending-scraper');

const router = express.Router();

router.get('/api/trending', async (req, res) => {
  const { since = 'daily' } = req.query;

  try {
    const cached = trendingCache.get(since);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        params: { since }
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

    res.json({
      success: true,
      data: reposWithChanges,
      params: { since }
    });
  } catch (error) {
    const stale = trendingCache.getLastSuccess(since);
    if (stale) {
      return res.json({
        success: true,
        data: stale.data,
        params: { since },
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

module.exports = router;
