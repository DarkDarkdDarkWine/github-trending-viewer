const mockGetStarredRepos = jest.fn();
const mockGetProviderForFeature = jest.fn();
const mockAxiosPost = jest.fn();
const mockEnsureSummaries = jest.fn();
const mockDb = {
  getUserInterestProfile: jest.fn(),
  setUserInterestProfile: jest.fn(),
  getLatestTrendingRepos: jest.fn(),
  getRecommendationScoresForRepos: jest.fn(),
  upsertRecommendationScores: jest.fn()
};

jest.mock('../github-client', () => ({
  getStarredRepos: mockGetStarredRepos
}));

jest.mock('../ai-provider', () => ({
  getProviderForFeature: mockGetProviderForFeature
}));

jest.mock('axios', () => ({
  post: mockAxiosPost
}));

jest.mock('../summarizer', () => ({
  ensureSummaries: mockEnsureSummaries
}));

jest.mock('../db', () => mockDb);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProviderForFeature.mockResolvedValue({
    preset: { baseUrl: 'https://ai.test', chatPath: '/chat/completions' },
    apiKey: 'sk-test',
    model: 'model-test'
  });
});

describe('recommender.refreshInterestProfile', () => {
  test('skips gracefully when there are no starred repos', async () => {
    mockGetStarredRepos.mockResolvedValue([]);

    const recommender = require('../recommender');
    const result = await recommender.refreshInterestProfile();

    expect(result).toEqual({ skipped: true, reason: 'no_starred_repos' });
    expect(mockAxiosPost).not.toHaveBeenCalled();
    expect(mockDb.setUserInterestProfile).not.toHaveBeenCalled();
  });

  test('caps starred repo prompt input to 150 repos', async () => {
    const starredRepos = Array.from({ length: 151 }, (_, index) => ({
      owner: 'owner',
      name: `repo-${index}`,
      full_name: `owner/repo-${index}`,
      description: `Description ${index}`.repeat(20),
      language: index % 2 === 0 ? 'JavaScript' : 'Python'
    }));
    mockGetStarredRepos.mockResolvedValue(starredRepos);
    mockAxiosPost.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              profile_text: '偏好 AI 工具、开发者效率和前端工程。',
              top_topics: ['AI', 'DX'],
              language_distribution: { JavaScript: 76, Python: 75 }
            })
          }
        }]
      }
    });

    const recommender = require('../recommender');
    await recommender.refreshInterestProfile();

    const requestBody = mockAxiosPost.mock.calls[0][1];
    const prompt = requestBody.messages[0].content;
    expect(prompt).toContain('owner/repo-149');
    expect(prompt).not.toContain('owner/repo-150');
    expect(mockDb.setUserInterestProfile).toHaveBeenCalledWith(expect.objectContaining({
      profile_text: '偏好 AI 工具、开发者效率和前端工程。',
      starred_count: 151,
      sampled_starred_count: 150
    }));
  });
});

describe('recommender.scoreTrendingForUser', () => {
  test('re-scores same-day repos when the profile hash changed', async () => {
    mockDb.getUserInterestProfile.mockResolvedValue({
      profile_text: '喜欢 AI 开发工具。',
      profile_hash: 'new-hash'
    });
    mockDb.getLatestTrendingRepos.mockResolvedValue([
      { owner: 'alpha', name: 'one', description: 'One', language: 'TypeScript', rank: 1 },
      { owner: 'beta', name: 'two', description: 'Two', language: 'Python', rank: 2 }
    ]);
    mockDb.getRecommendationScoresForRepos.mockResolvedValue({
      'alpha/one': { score: 10, reason: '旧画像', profile_hash: 'old-hash' }
    });
    mockEnsureSummaries.mockResolvedValue(new Map([
      ['alpha/one', 'AI coding tool'],
      ['beta/two', 'Python agent framework']
    ]));
    mockAxiosPost.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify([
              { index: 0, score: 91, reason: '匹配 AI 开发工具兴趣' },
              { index: 1, score: 72, reason: '部分匹配 Python/Agent 兴趣' }
            ])
          }
        }]
      }
    });

    const recommender = require('../recommender');
    const result = await recommender.scoreTrendingForUser('daily');

    expect(result.scored).toBe(2);
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockDb.upsertRecommendationScores).toHaveBeenCalledWith([
      expect.objectContaining({ owner: 'alpha', name: 'one', score: 91, profile_hash: 'new-hash' }),
      expect.objectContaining({ owner: 'beta', name: 'two', score: 72, profile_hash: 'new-hash' })
    ]);
  });

  test('skips batches with invalid AI JSON without throwing', async () => {
    mockDb.getUserInterestProfile.mockResolvedValue({
      profile_text: '喜欢基础设施。',
      profile_hash: 'hash'
    });
    mockDb.getLatestTrendingRepos.mockResolvedValue([
      { owner: 'alpha', name: 'one', description: 'One', language: 'Go', rank: 1 }
    ]);
    mockDb.getRecommendationScoresForRepos.mockResolvedValue({});
    mockEnsureSummaries.mockResolvedValue(new Map());
    mockAxiosPost.mockResolvedValue({ data: { choices: [{ message: { content: 'not json' } }] } });

    const recommender = require('../recommender');
    const result = await recommender.scoreTrendingForUser('daily');

    expect(result).toEqual(expect.objectContaining({ scored: 0, failedBatches: 1 }));
    expect(mockDb.upsertRecommendationScores).not.toHaveBeenCalled();
  });
});
