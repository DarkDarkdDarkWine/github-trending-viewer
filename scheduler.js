const cron = require('node-cron');

// All cron times are in UTC. Shanghai is UTC+8.
// Daily trending scrape: 14:00, 18:00, 22:00 UTC → 22:00, 02:00, 06:00 CST
// Weekly: Monday 15:00 UTC → Monday 23:00 CST
// Monthly: 1st 15:00 UTC → 1st 23:00 CST

function startScheduler(scrapeCallback) {
  // Daily trending — scrape multiple times to ensure coverage
  cron.schedule('0 14,18,22 * * *', async () => {
    console.log('[Scheduler] Running daily trending scrape...');
    try {
      await scrapeCallback('daily');
      console.log('[Scheduler] Daily scrape complete');
    } catch (err) {
      console.error('[Scheduler] Daily scrape failed:', err.message);
    }
  });

  // Weekly trending — every Monday
  cron.schedule('0 15 * * 1', async () => {
    console.log('[Scheduler] Running weekly trending scrape...');
    try {
      await scrapeCallback('weekly');
      console.log('[Scheduler] Weekly scrape complete');
    } catch (err) {
      console.error('[Scheduler] Weekly scrape failed:', err.message);
    }
  });

  // Monthly trending — 1st of each month
  cron.schedule('0 15 1 * *', async () => {
    console.log('[Scheduler] Running monthly trending scrape...');
    try {
      await scrapeCallback('monthly');
      console.log('[Scheduler] Monthly scrape complete');
    } catch (err) {
      console.error('[Scheduler] Monthly scrape failed:', err.message);
    }
  });

  console.log('[Scheduler] Cron jobs registered (daily: 14/18/22 UTC, weekly: Mon 15 UTC, monthly: 1st 15 UTC)');
}

module.exports = { startScheduler };
