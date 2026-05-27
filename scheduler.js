const cron = require('node-cron');
const db = require('./db');
const { runScheduledReports } = require('./analyzer');
const rankingHistory = require('./src/services/ranking-history');
const trendingCache = require('./src/services/trending-cache');
const { scrapeTrending } = require('./src/services/trending-scraper');
const recommender = require('./recommender');

function startScheduler() {
  cron.schedule('0 14,18,22 * * *', () => runTrendingJob('daily'));
  cron.schedule('0 15 * * 1', () => runTrendingJob('weekly'));
  cron.schedule('0 15 1 * *', () => runTrendingJob('monthly'));

  console.log('[Scheduler] Cron jobs registered (daily: 14/18/22 UTC, weekly: Mon 15 UTC, monthly: 1st 15 UTC)');
}

async function runTrendingJob(since) {
  console.log(`[Scheduler] Running ${since} trending scrape...`);
  try {
    const repos = await scrapeTrending(since);
    const changes = await rankingHistory.getChanges(repos, since);
    const reposWithChanges = repos.map((repo, index) => ({
      ...repo,
      rankingChange: changes[index]
    }));

    await db.saveTrendingData(repos, since);
    trendingCache.set(since, reposWithChanges);
    console.log(`[Scheduler] ${since} scrape complete`);

    await refreshRecommendationScores(since);

    if (since === 'daily') {
      await runScheduledReports();
    }
  } catch (err) {
    console.error(`[Scheduler] ${since} scrape failed:`, err.message);
  }
}

async function refreshRecommendationScores(since) {
  try {
    await recommender.refreshInterestProfile();
  } catch (err) {
    console.warn('[Scheduler] Recommendation profile refresh failed:', err.message);
  }

  try {
    await recommender.scoreTrendingForUser(since);
  } catch (err) {
    console.warn(`[Scheduler] Recommendation scoring failed for ${since}:`, err.message);
  }
}

module.exports = { runTrendingJob, startScheduler };
