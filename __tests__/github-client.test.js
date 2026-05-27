/**
 * Tests for github-client.js module
 *
 * Covers:
 * - Batch star status check (GraphQL aliases)
 * - Starred repos list (Octokit REST)
 * - Batch repo activity (GraphQL releases + commits)
 * - Cache TTL behavior
 * - No-token graceful degradation
 */

// We mock @octokit/rest and @octokit/graphql at the module level
// so github-client.js can be required without real API calls.

const mockGraphql = jest.fn();
const mockRestActivity = {
  listReposStarredByAuthenticatedUser: jest.fn()
};
const mockOctokit = {
  paginate: jest.fn(),
  rest: { activity: mockRestActivity }
};

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn(() => mockOctokit)
}));

jest.mock('@octokit/graphql', () => ({
  graphql: {
    defaults: jest.fn(() => mockGraphql)
  }
}));

// Clear all mocks and reset modules before each test
beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  // Clear the GITHUB_TOKEN env var between tests
  delete process.env.GITHUB_TOKEN;
});

// ─── No-token graceful degradation ────────────────────────────────────────

describe('github-client: no token', () => {
  test('checkStarredBatch returns null statuses when no token', async () => {
    const gc = require('../github-client');
    const repos = [
      { owner: 'torvalds', name: 'linux' },
      { owner: 'facebook', name: 'react' }
    ];
    const result = await gc.checkStarredBatch(repos);
    expect(result).toEqual([
      { owner: 'torvalds', name: 'linux', starred: null },
      { owner: 'facebook', name: 'react', starred: null }
    ]);
  });

  test('getStarredRepos returns empty array when no token', async () => {
    const gc = require('../github-client');
    const result = await gc.getStarredRepos();
    expect(result).toEqual([]);
  });

  test('getStarredRepoActivityBatch returns empty array when no token', async () => {
    const gc = require('../github-client');
    const result = await gc.getStarredRepoActivityBatch([]);
    expect(result).toEqual([]);
  });
});

// ─── checkStarredBatch ─────────────────────────────────────────────────────

describe('github-client: checkStarredBatch', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'ghp_test_token';
  });

  test('sends single GraphQL query with aliases for all repos', async () => {
    mockGraphql.mockResolvedValue({
      repo0: { viewerHasStarred: true },
      repo1: { viewerHasStarred: false }
    });

    const gc = require('../github-client');
    const repos = [
      { owner: 'torvalds', name: 'linux' },
      { owner: 'facebook', name: 'react' }
    ];
    const result = await gc.checkStarredBatch(repos);

    // Should call graphql exactly once
    expect(mockGraphql).toHaveBeenCalledTimes(1);

    // The query should contain aliases for both repos
    const query = mockGraphql.mock.calls[0][0];
    expect(query).toContain('repo0: repository(owner: "torvalds", name: "linux")');
    expect(query).toContain('repo1: repository(owner: "facebook", name: "react")');
    expect(query).toContain('viewerHasStarred');

    // Result shape matches current API contract
    expect(result).toEqual([
      { owner: 'torvalds', name: 'linux', starred: true },
      { owner: 'facebook', name: 'react', starred: false }
    ]);
  });

  test('returns null for repos missing from GraphQL response', async () => {
    mockGraphql.mockResolvedValue({
      repo0: { viewerHasStarred: true }
      // repo1 missing (e.g., repo doesn't exist)
    });

    const gc = require('../github-client');
    const repos = [
      { owner: 'torvalds', name: 'linux' },
      { owner: 'nonexistent', name: 'missing' }
    ];
    const result = await gc.checkStarredBatch(repos);

    expect(result[0].starred).toBe(true);
    expect(result[1].starred).toBeNull();
  });

  test('returns null statuses on GraphQL error', async () => {
    mockGraphql.mockRejectedValue(new Error('GraphQL error'));

    const gc = require('../github-client');
    const repos = [{ owner: 'torvalds', name: 'linux' }];
    const result = await gc.checkStarredBatch(repos);

    expect(result).toEqual([
      { owner: 'torvalds', name: 'linux', starred: null }
    ]);
  });
});

// ─── getStarredRepos ───────────────────────────────────────────────────────

describe('github-client: getStarredRepos', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'ghp_test_token';
  });

  test('calls Octokit REST API with correct params', async () => {
    mockOctokit.paginate.mockResolvedValue([
      {
        owner: { login: 'torvalds' },
        name: 'linux',
        full_name: 'torvalds/linux',
        description: 'Linux kernel',
        language: 'C',
        html_url: 'https://github.com/torvalds/linux',
        updated_at: '2026-04-15T00:00:00Z'
      },
      {
        owner: { login: 'facebook' },
        name: 'react',
        full_name: 'facebook/react',
        description: 'React',
        language: 'JavaScript',
        html_url: 'https://github.com/facebook/react',
        updated_at: '2026-04-14T00:00:00Z'
      }
    ]);

    const gc = require('../github-client');
    const result = await gc.getStarredRepos();

    expect(mockOctokit.paginate).toHaveBeenCalledWith(
      mockRestActivity.listReposStarredByAuthenticatedUser,
      {
        per_page: 100,
        sort: 'updated',
        direction: 'desc'
      }
    );
    expect(mockRestActivity.listReposStarredByAuthenticatedUser).not.toHaveBeenCalled();

    expect(result).toEqual([{
      owner: 'torvalds',
      name: 'linux',
      full_name: 'torvalds/linux',
      description: 'Linux kernel',
      descriptionZh: 'Linux kernel',
      language: 'C',
      url: 'https://github.com/torvalds/linux',
      updated_at: '2026-04-15T00:00:00Z'
    }, {
      owner: 'facebook',
      name: 'react',
      full_name: 'facebook/react',
      description: 'React',
      descriptionZh: 'React',
      language: 'JavaScript',
      url: 'https://github.com/facebook/react',
      updated_at: '2026-04-14T00:00:00Z'
    }]);
  });

  test('uses Octokit pagination to fetch more than the first page', async () => {
    const repos = Array.from({ length: 125 }, (_, index) => ({
      owner: { login: 'owner' },
      name: `repo-${index}`,
      full_name: `owner/repo-${index}`,
      description: `Repository ${index}`,
      language: 'JavaScript',
      html_url: `https://github.com/owner/repo-${index}`,
      updated_at: '2026-04-15T00:00:00Z'
    }));
    mockOctokit.paginate.mockResolvedValue(repos);

    const gc = require('../github-client');
    const result = await gc.getStarredRepos();

    expect(result).toHaveLength(125);
    expect(result[124].full_name).toBe('owner/repo-124');
    expect(mockOctokit.paginate).toHaveBeenCalledWith(
      mockRestActivity.listReposStarredByAuthenticatedUser,
      {
      per_page: 100,
      sort: 'updated',
      direction: 'desc'
      }
    );
  });

  test('returns empty array on API error', async () => {
    mockOctokit.paginate.mockRejectedValue(
      new Error('API error')
    );

    const gc = require('../github-client');
    const result = await gc.getStarredRepos();
    expect(result).toEqual([]);
  });
});

// ─── getStarredRepoActivityBatch ───────────────────────────────────────────

describe('github-client: getStarredRepoActivityBatch', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'ghp_test_token';
  });

  test('fetches releases and commits via GraphQL in batch', async () => {
    // Mock GraphQL to return releases and commits for a single repo
    mockGraphql.mockResolvedValue({
      repo0: {
        releases: {
          nodes: [{
            tagName: 'v1.0.0',
            name: 'Release 1.0',
            description: 'First release',
            publishedAt: '2026-04-14T00:00:00Z',
            createdAt: '2026-04-14T00:00:00Z',
            author: { login: 'dev', avatarUrl: 'https://avatar.dev' }
          }]
        },
        defaultBranchRef: {
          target: {
            history: {
              nodes: [{
                messageHeadline: 'fix: bug',
                oid: 'abc123def456',
                authoredDate: '2026-04-15T10:00:00Z',
                author: {
                  user: { login: 'dev', avatarUrl: 'https://avatar.dev' },
                  name: 'Developer'
                }
              }]
            }
          }
        }
      }
    });

    const gc = require('../github-client');
    const repos = [{
      owner: 'torvalds',
      name: 'linux',
      full_name: 'torvalds/linux',
      description: 'Linux kernel',
      language: 'C',
      url: 'https://github.com/torvalds/linux',
      updated_at: '2026-04-15T00:00:00Z'
    }];

    const result = await gc.getStarredRepoActivityBatch(repos);

    // Should have made at least 1 GraphQL call
    expect(mockGraphql).toHaveBeenCalled();

    // Result should contain both release and commit events
    expect(result.length).toBeGreaterThanOrEqual(2);

    // Find the release event
    const release = result.find(e => e.type === 'ReleaseEvent');
    expect(release).toBeDefined();
    expect(release.repo).toBe('torvalds/linux');
    expect(release.actor).toBe('dev');
    expect(release.avatar).toBe('https://avatar.dev');
    expect(release.details).toEqual({
      tag: 'v1.0.0',
      name: 'Release 1.0',
      body: 'First release'
    });

    // Find the commit event
    const commit = result.find(e => e.type === 'PushEvent');
    expect(commit).toBeDefined();
    expect(commit.repo).toBe('torvalds/linux');
    expect(commit.details.sha).toBe('abc123d');
    expect(commit.details.message).toBe('fix: bug');
  });

  test('events are sorted by date descending', async () => {
    mockGraphql.mockResolvedValue({
      repo0: {
        releases: {
          nodes: [{
            tagName: 'v1.0.0',
            name: 'R1',
            body: '',
            publishedAt: '2026-04-10T00:00:00Z',
            createdAt: '2026-04-10T00:00:00Z',
            author: { login: 'dev', avatarUrl: '' }
          }]
        },
        defaultBranchRef: {
          target: {
            history: {
              nodes: [{
                messageHeadline: 'new commit',
                oid: 'abc123',
                authoredDate: '2026-04-15T00:00:00Z',
                author: { user: { login: 'dev', avatarUrl: '' }, name: 'Dev' }
              }]
            }
          }
        }
      }
    });

    const gc = require('../github-client');
    const repos = [{
      owner: 'torvalds', name: 'linux',
      full_name: 'torvalds/linux', description: '', language: 'C',
      url: 'https://github.com/torvalds/linux', updated_at: '2026-04-15T00:00:00Z'
    }];

    const result = await gc.getStarredRepoActivityBatch(repos);

    // Commit (Apr 15) should come before Release (Apr 10)
    expect(result[0].type).toBe('PushEvent');
    expect(result[1].type).toBe('ReleaseEvent');
  });

  test('handles repo with null defaultBranchRef gracefully', async () => {
    mockGraphql.mockResolvedValue({
      repo0: {
        releases: { nodes: [] },
        defaultBranchRef: null
      }
    });

    const gc = require('../github-client');
    const repos = [{
      owner: 'some', name: 'repo',
      full_name: 'some/repo', description: '', language: '',
      url: 'https://github.com/some/repo', updated_at: '2026-04-15T00:00:00Z'
    }];

    const result = await gc.getStarredRepoActivityBatch(repos);
    expect(result).toEqual([]);
  });

  test('returns empty array on GraphQL error', async () => {
    mockGraphql.mockRejectedValue(new Error('GraphQL error'));

    const gc = require('../github-client');
    const result = await gc.getStarredRepoActivityBatch([
      { owner: 'torvalds', name: 'linux', full_name: 'torvalds/linux', description: '', language: 'C', url: '', updated_at: '' }
    ]);
    expect(result).toEqual([]);
  });
});

// ─── Cache behavior ────────────────────────────────────────────────────────

describe('github-client: cache', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'ghp_test_token';
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('getStarredRepos returns cached result within TTL', async () => {
    mockOctokit.paginate.mockResolvedValue([{
        owner: { login: 'torvalds' },
        name: 'linux',
        full_name: 'torvalds/linux',
        description: 'Linux kernel',
        language: 'C',
        html_url: 'https://github.com/torvalds/linux',
        updated_at: '2026-04-15T00:00:00Z'
    }]);

    const gc = require('../github-client');

    // First call — hits API
    await gc.getStarredRepos();
    expect(mockOctokit.paginate).toHaveBeenCalledTimes(1);

    // Second call within TTL — should use cache
    await gc.getStarredRepos();
    expect(mockOctokit.paginate).toHaveBeenCalledTimes(1);

    // Advance past TTL (5 minutes + 1ms)
    jest.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Third call — cache expired, hits API again
    await gc.getStarredRepos();
    expect(mockOctokit.paginate).toHaveBeenCalledTimes(2);
  });

  test('checkStarredBatch returns cached result within TTL', async () => {
    mockGraphql.mockResolvedValue({
      repo0: { viewerHasStarred: true }
    });

    const gc = require('../github-client');
    const repos = [{ owner: 'torvalds', name: 'linux' }];

    // First call — hits GraphQL
    await gc.checkStarredBatch(repos);
    expect(mockGraphql).toHaveBeenCalledTimes(1);

    // Second call — cache hit
    await gc.checkStarredBatch(repos);
    expect(mockGraphql).toHaveBeenCalledTimes(1);
  });

  test('checkStarredBatch cache key differs for different repos', async () => {
    mockGraphql
      .mockResolvedValueOnce({ repo0: { viewerHasStarred: true } })
      .mockResolvedValueOnce({ repo0: { viewerHasStarred: false } });

    const gc = require('../github-client');

    await gc.checkStarredBatch([{ owner: 'torvalds', name: 'linux' }]);
    await gc.checkStarredBatch([{ owner: 'facebook', name: 'react' }]);

    // Different repos = different cache keys = 2 API calls
    expect(mockGraphql).toHaveBeenCalledTimes(2);
  });
});

// ─── getStarredDashboard ───────────────────────────────────────────────────

describe('github-client: getStarredDashboard', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'ghp_test_token';
  });

  test('returns dashboard data with summary and sorted repos (releases first)', async () => {
    mockOctokit.paginate.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        owner: { login: 'owner' },
        name: `repo${i}`,
        full_name: `owner/repo${i}`,
        description: `Repo ${i}`,
        language: i % 2 === 0 ? 'TypeScript' : 'Python',
        html_url: `https://github.com/owner/repo${i}`,
        updated_at: `2026-04-${16 - i}T00:00:00Z`,
        stargazers_count: 1000 + i * 100,
        forks_count: 50 + i * 10
      }))
    );

    mockGraphql.mockResolvedValue({
      repo0: {
        description: 'Repo 0',
        stargazerCount: 1000,
        forkCount: 50,
        updatedAt: '2026-04-16T00:00:00Z',
        releases: {
          nodes: [{
            tagName: 'v2.0.0',
            name: 'Release 2.0',
            description: 'Big update',
            publishedAt: '2026-04-15T00:00:00Z'
          }]
        },
        defaultBranchRef: {
          target: {
            history: {
              nodes: [{
                messageHeadline: 'fix: something',
                oid: 'abc123def456',
                authoredDate: '2026-04-16T10:00:00Z',
                author: { user: { login: 'dev' }, name: 'Dev' }
              }]
            }
          }
        }
      },
      repo1: {
        description: 'Repo 1',
        stargazerCount: 1100,
        forkCount: 60,
        updatedAt: '2026-04-15T00:00:00Z',
        releases: { nodes: [] },
        defaultBranchRef: {
          target: {
            history: {
              nodes: [{
                messageHeadline: 'feat: add thing',
                oid: 'def456abc789',
                authoredDate: '2026-04-15T08:00:00Z',
                author: { user: { login: 'dev2' }, name: 'Dev2' }
              }]
            }
          }
        }
      }
    });

    const gc = require('../github-client');
    const result = await gc.getStarredDashboard();

    expect(result.summary).toBeDefined();
    expect(result.summary.total_starred).toBe(5);
    expect(result.summary.shown).toBe(5);
    expect(result.summary.with_release).toBeGreaterThanOrEqual(1);

    expect(result.repos.length).toBeGreaterThan(0);
    const firstRepo = result.repos[0];
    expect(firstRepo.latest_release).toBeDefined();
    expect(firstRepo.latest_release.tag).toBe('v2.0.0');
    expect(firstRepo.owner).toBe('owner');
    expect(firstRepo.stars).toBeDefined();
    expect(firstRepo.recent_commits).toBeInstanceOf(Array);
  });

  test('returns empty dashboard when no token', async () => {
    delete process.env.GITHUB_TOKEN;
    const gc = require('../github-client');
    const result = await gc.getStarredDashboard();
    expect(result).toEqual({ summary: { total_starred: 0, shown: 0, with_release: 0, active_7d: 0 }, repos: [] });
  });

  test('returns empty dashboard when no starred repos', async () => {
    mockOctokit.paginate.mockResolvedValue([]);
    const gc = require('../github-client');
    const result = await gc.getStarredDashboard();
    expect(result.repos).toEqual([]);
    expect(result.summary.total_starred).toBe(0);
  });

  test('handles GraphQL error gracefully with REST fallback', async () => {
    mockOctokit.paginate.mockResolvedValue([{
        owner: { login: 'owner' }, name: 'repo',
        full_name: 'owner/repo', description: 'Test', language: 'JS',
        html_url: 'https://github.com/owner/repo', updated_at: '2026-04-16T00:00:00Z',
        stargazers_count: 100, forks_count: 10
    }]);
    mockGraphql.mockRejectedValue(new Error('GraphQL error'));

    const gc = require('../github-client');
    const result = await gc.getStarredDashboard();
    expect(result.repos.length).toBe(1);
    expect(result.repos[0].recent_commits).toEqual([]);
    expect(result.repos[0].latest_release).toBeNull();
  });
});
