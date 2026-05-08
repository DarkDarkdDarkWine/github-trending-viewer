/**
 * Tests for server.js route changes after github-client integration.
 *
 * Verifies:
 * - /api/check-starred delegates to github-client.checkStarredBatch
 * - /api/starred-activity delegates to github-client batch functions
 * - /api/trending caches scrape results
 */

const request = require('supertest');

const mockCheckStarredBatch = jest.fn();
const mockGetStarredRepos = jest.fn();
const mockGetStarredRepoActivityBatch = jest.fn();
const mockGetStarredDashboard = jest.fn();

jest.mock('../github-client', () => ({
  checkStarredBatch: mockCheckStarredBatch,
  getStarredRepos: mockGetStarredRepos,
  getStarredRepoActivityBatch: mockGetStarredRepoActivityBatch,
  getStarredDashboard: mockGetStarredDashboard
}));

// Mock axios to control the trending scrape
const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({
  ...jest.requireActual('axios'),
  get: mockAxiosGet
}));

// Mock db module
jest.mock('../db', () => ({
  saveTrendingData: jest.fn().mockResolvedValue({}),
  ensureReportsSchema: jest.fn().mockResolvedValue(),
  getPreviousRanking: jest.fn().mockResolvedValue(null)
}));

jest.mock('../analyzer', () => ({
  runScheduledReports: jest.fn()
}));

jest.mock('../ai-provider', () => ({
  translate: jest.fn(),
  getPresets: jest.fn().mockResolvedValue([]),
  upsertProvider: jest.fn(),
  removeProvider: jest.fn(),
  testProvider: jest.fn(),
  fetchModels: jest.fn(),
  getTaskAssign: jest.fn().mockResolvedValue({}),
  updateTaskAssign: jest.fn(),
  updateModels: jest.fn()
}));

jest.mock('pg', () => {
  const mPool = { query: jest.fn(), on: jest.fn(), connect: jest.fn() };
  return { Pool: jest.fn(() => mPool) };
});

let app;

beforeAll(() => {
  process.env.GITHUB_TOKEN = 'ghp_test';
  // Prevent actual listen during test
  process.env.NODE_ENV = 'test';
  app = require('../server');
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── /api/check-starred ────────────────────────────────────────────────────

describe('/api/check-starred', () => {
  test('delegates to github-client.checkStarredBatch', async () => {
    const repos = [
      { owner: 'torvalds', name: 'linux' },
      { owner: 'facebook', name: 'react' }
    ];

    mockCheckStarredBatch.mockResolvedValue([
      { owner: 'torvalds', name: 'linux', starred: true },
      { owner: 'facebook', name: 'react', starred: false }
    ]);

    const res = await request(app)
      .post('/api/check-starred')
      .send({ repos });

    expect(mockCheckStarredBatch).toHaveBeenCalledTimes(1);
    expect(mockCheckStarredBatch).toHaveBeenCalledWith(repos);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].starred).toBe(true);
    expect(res.body.data[1].starred).toBe(false);
  });

  test('returns null statuses when github-client returns null', async () => {
    mockCheckStarredBatch.mockResolvedValue([
      { owner: 'test', name: 'repo', starred: null }
    ]);

    const res = await request(app)
      .post('/api/check-starred')
      .send({ repos: [{ owner: 'test', name: 'repo' }] });

    expect(res.body.success).toBe(true);
    expect(res.body.data[0].starred).toBeNull();
  });
});

// ─── /api/starred-activity ─────────────────────────────────────────────────

describe('/api/starred-activity', () => {
  test('delegates to github-client batch functions', async () => {
    const starredRepos = [{
      owner: 'torvalds', name: 'linux',
      full_name: 'torvalds/linux', description: 'Linux kernel',
      descriptionZh: 'Linux kernel', language: 'C',
      url: 'https://github.com/torvalds/linux',
      updated_at: '2026-04-15T00:00:00Z'
    }];

    const activities = [{
      type: 'ReleaseEvent',
      repo: 'torvalds/linux',
      actor: 'torvalds',
      avatar: 'https://avatar.test',
      created_at: '2026-04-14T00:00:00Z',
      details: { tag: 'v6.0', name: 'Linux 6.0', body: 'New kernel' },
      repo_info: starredRepos[0]
    }];

    mockGetStarredRepos.mockResolvedValue(starredRepos);
    mockGetStarredRepoActivityBatch.mockResolvedValue(activities);

    const res = await request(app)
      .get('/api/starred-activity');

    expect(mockGetStarredRepos).toHaveBeenCalledTimes(1);
    expect(mockGetStarredRepoActivityBatch).toHaveBeenCalledTimes(1);
    expect(mockGetStarredRepoActivityBatch).toHaveBeenCalledWith(starredRepos.slice(0, 30));
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe('ReleaseEvent');
    expect(res.body.data[0].details.tag).toBe('v6.0');
  });

  test('returns empty data when no starred repos', async () => {
    mockGetStarredRepos.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/starred-activity');

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(mockGetStarredRepoActivityBatch).not.toHaveBeenCalled();
  });
});

// ─── /api/trending caching ─────────────────────────────────────────────────

describe('/api/trending caching', () => {
  test('second request within TTL uses cache instead of re-scraping', async () => {
    mockAxiosGet.mockResolvedValue({
      data: `
        <html><body>
        <article class="Box-row">
          <h2><a href="/torvalds/linux"></a></h2>
          <p class="col-9">Linux kernel</p>
          <span itemprop="programmingLanguage">C</span>
          <a href="/torvalds/linux/stargazers">100k</a>
          <span class="float-sm-right">500 stars today</span>
        </article>
        </body></html>
      `
    });

    // First request — triggers scrape
    const res1 = await request(app).get('/api/trending?since=daily');
    expect(res1.body.success).toBe(true);
    expect(res1.body.data.length).toBeGreaterThan(0);

    const firstCallCount = mockAxiosGet.mock.calls.length;

    // Second request — should hit cache
    const res2 = await request(app).get('/api/trending?since=daily');
    expect(res2.body.success).toBe(true);

    // axios.get should NOT have been called again
    expect(mockAxiosGet.mock.calls.length).toBe(firstCallCount);
  });
});

// ─── /api/starred-dashboard ────────────────────────────────────────────────

describe('/api/starred-dashboard', () => {
  test('returns dashboard data with summary and repos', async () => {
    const dashboardData = {
      summary: { total_starred: 5, shown: 3, with_release: 1, active_7d: 2 },
      repos: [
        {
          owner: 'n8n-io', name: 'n8n', full_name: 'n8n-io/n8n',
          description: 'Workflow automation', language: 'TypeScript',
          stars: 75200, forks: 2100, url: 'https://github.com/n8n-io/n8n',
          updated_at: '2026-04-16T00:00:00Z',
          latest_release: { tag: 'v1.5.0', name: 'n8n 1.5.0', body: '', date: '2026-04-14T00:00:00Z' },
          recent_commits: [{ message: 'fix: auth', sha: 'abc123d', date: '2026-04-16T10:00:00Z', author: 'dev' }]
        },
        {
          owner: 'torvalds', name: 'linux', full_name: 'torvalds/linux',
          description: 'Linux kernel', language: 'C',
          stars: 200000, forks: 50000, url: 'https://github.com/torvalds/linux',
          updated_at: '2026-04-15T00:00:00Z',
          latest_release: null,
          recent_commits: [{ message: 'merge: fix', sha: 'def456a', date: '2026-04-15T08:00:00Z', author: 'torvalds' }]
        }
      ]
    };

    mockGetStarredDashboard.mockResolvedValue(dashboardData);

    const res = await request(app).get('/api/starred-dashboard');

    expect(mockGetStarredDashboard).toHaveBeenCalledTimes(1);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary.total_starred).toBe(5);
    expect(res.body.data.summary.with_release).toBe(1);
    expect(res.body.data.repos).toHaveLength(2);
    expect(res.body.data.repos[0].latest_release.tag).toBe('v1.5.0');
    expect(res.body.data.repos[1].latest_release).toBeNull();
  });

  test('returns empty dashboard when no token', async () => {
    mockGetStarredDashboard.mockResolvedValue({
      summary: { total_starred: 0, shown: 0, with_release: 0, active_7d: 0 },
      repos: []
    });

    const res = await request(app).get('/api/starred-dashboard');
    expect(res.body.success).toBe(true);
    expect(res.body.data.repos).toEqual([]);
  });
});
