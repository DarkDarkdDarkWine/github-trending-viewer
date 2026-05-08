const express = require('express');
const githubClient = require('../../github-client');

const router = express.Router();

router.post('/api/check-starred', async (req, res) => {
  try {
    const { repos } = req.body;
    const starredStatus = await githubClient.checkStarredBatch(repos);
    res.json({ success: true, data: starredStatus });
  } catch (error) {
    console.error('Error checking starred status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/starred-activity', async (req, res) => {
  try {
    if (!process.env.GITHUB_TOKEN) {
      return res.json({ success: false, message: 'GitHub token not configured' });
    }

    const repos = await githubClient.getStarredRepos();
    if (repos.length === 0) {
      return res.json({ success: true, data: [], message: 'No starred repos found' });
    }

    const top30 = repos.slice(0, 30);
    const allEvents = await githubClient.getStarredRepoActivityBatch(top30);
    res.json({ success: true, data: allEvents.slice(0, 50) });
  } catch (error) {
    console.error('Error fetching starred activity:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/starred-dashboard', async (req, res) => {
  try {
    if (!process.env.GITHUB_TOKEN) {
      return res.json({
        success: true,
        data: { summary: { total_starred: 0, shown: 0, with_release: 0, active_7d: 0 }, repos: [] }
      });
    }

    const dashboard = await githubClient.getStarredDashboard();
    res.json({ success: true, data: dashboard });
  } catch (error) {
    console.error('Error fetching starred dashboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
