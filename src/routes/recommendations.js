const express = require('express');
const aiProvider = require('../../ai-provider');
const githubClient = require('../../github-client');
const recommender = require('../../recommender');

const router = express.Router();
const SINCE_VALUES = ['daily', 'weekly', 'monthly'];

router.post('/api/recommendations/refresh', async (req, res) => {
  try {
    if (!githubClient.hasGithubToken()) {
      return res.status(400).json({
        success: false,
        code: 'github_token_required',
        error: '请先配置 GITHUB_TOKEN，用于读取你的 Star 仓库'
      });
    }

    const provider = await aiProvider.getProviderForFeature('recommendation');
    if (!provider) {
      return res.status(400).json({
        success: false,
        code: 'ai_provider_required',
        error: '请先配置支持推荐任务的 AI Provider'
      });
    }

    const requestedSince = req.body?.since;
    const sinceList = requestedSince ? [requestedSince] : SINCE_VALUES;
    if (sinceList.some(since => !SINCE_VALUES.includes(since))) {
      return res.status(400).json({
        success: false,
        code: 'invalid_since',
        error: 'since must be daily, weekly, or monthly'
      });
    }

    const profile = await recommender.refreshInterestProfile();
    if (profile.skipped) {
      const status = profile.reason === 'no_starred_repos' ? 400 : 502;
      return res.status(status).json({
        success: false,
        code: profile.reason,
        error: recommendationErrorText(profile.reason)
      });
    }

    const scores = [];
    for (const since of sinceList) {
      scores.push(await recommender.scoreTrendingForUser(since));
    }

    res.json({
      success: true,
      data: { profile, scores }
    });
  } catch (error) {
    console.error('Recommendation refresh failed:', error);
    res.status(500).json({
      success: false,
      code: 'recommendation_refresh_failed',
      error: error.message
    });
  }
});

function recommendationErrorText(reason) {
  if (reason === 'no_starred_repos') return '没有可用于生成兴趣画像的 Star 仓库';
  if (reason === 'no_ai_provider') return '请先配置支持推荐任务的 AI Provider';
  if (reason === 'ai_failed') return 'AI 生成兴趣画像失败，请稍后重试';
  return '推荐刷新失败';
}

module.exports = router;
