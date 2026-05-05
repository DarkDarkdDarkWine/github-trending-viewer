# Star Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat event-stream Star tab with a repo-card dashboard and add a Star-filter button to the Trending page.

**Architecture:** New backend function `getStarredDashboard()` in `github-client.js` uses GraphQL batch queries to fetch per-repo snapshots (basic info + latest release + recent commits). New `/api/starred-dashboard` route serves this data. Frontend re-renders the Star tab as a card grid with summary bar. Trending page gets a client-side filter toggle.

**Tech Stack:** Node.js, Express, @octokit/graphql (existing), Jest + Supertest (existing), vanilla HTML/CSS/JS (existing)

---

### Task 1: Backend — `getStarredDashboard()` in github-client.js

**Files:**
- Modify: `github-client.js` — add new function + export
- Modify: `__tests__/github-client.test.js` — add dashboard tests

- [ ] **Step 1: Write failing tests for `getStarredDashboard()`**

Add to `__tests__/github-client.test.js` (inside the existing file, before the closing of the file, after the cache tests). The mock setup for `@octokit/graphql` and `@octokit/rest` already exists at the top of the file.

```js
// ─── getStarredDashboard ───────────────────────────────────────────────────

describe('github-client: getStarredDashboard', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'ghp_test_token';
  });

  test('returns dashboard data with summary and sorted repos', async () => {
    mockRestActivity.listReposStarredByAuthenticatedUser.mockResolvedValue({
      data: Array.from({ length: 5 }, (_, i) => ({
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
    });

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

    // Summary exists
    expect(result.summary).toBeDefined();
    expect(result.summary.total_starred).toBe(5);
    expect(result.summary.shown).toBe(5);
    expect(result.summary.with_release).toBeGreaterThanOrEqual(1);

    // Repos sorted: releases first
    expect(result.repos.length).toBeGreaterThan(0);
    const firstRepo = result.repos[0];
    expect(firstRepo.latest_release).toBeDefined();
    expect(firstRepo.latest_release.tag).toBe('v2.0.0');

    // Repo snapshot shape
    expect(firstRepo.owner).toBe('owner');
    expect(firstRepo.name).toBeDefined();
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
    mockRestActivity.listReposStarredByAuthenticatedUser.mockResolvedValue({ data: [] });
    const gc = require('../github-client');
    const result = await gc.getStarredDashboard();
    expect(result.repos).toEqual([]);
    expect(result.summary.total_starred).toBe(0);
  });

  test('handles GraphQL error gracefully', async () => {
    mockRestActivity.listReposStarredByAuthenticatedUser.mockResolvedValue({
      data: [{
        owner: { login: 'owner' }, name: 'repo',
        full_name: 'owner/repo', description: '', language: 'JS',
        html_url: 'https://github.com/owner/repo', updated_at: '2026-04-16T00:00:00Z',
        stargazers_count: 100, forks_count: 10
      }]
    });
    mockGraphql.mockRejectedValue(new Error('GraphQL error'));

    const gc = require('../github-client');
    const result = await gc.getStarredDashboard();
    // Should still return repos (from REST list) but without GraphQL details
    expect(result.repos.length).toBe(1);
    expect(result.repos[0].recent_commits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "Tests:|getStarredDashboard"`
Expected: FAIL — `gc.getStarredDashboard is not a function`

- [ ] **Step 3: Implement `getStarredDashboard()` in github-client.js**

Add before the `module.exports` block:

```js
// ─── Starred Dashboard (per-repo snapshot) ─────────────────────────────────

async function getStarredDashboard() {
  if (!GITHUB_TOKEN) {
    return { summary: { total_starred: 0, shown: 0, with_release: 0, active_7d: 0 }, repos: [] };
  }

  const allStarred = await getStarredRepos();
  if (allStarred.length === 0) {
    return { summary: { total_starred: 0, shown: 0, with_release: 0, active_7d: 0 }, repos: [] };
  }

  const top30 = allStarred.slice(0, 30);
  const client = getClient();
  const CHUNK_SIZE = 15;
  const repoSnapshots = [];

  for (let i = 0; i < top30.length; i += CHUNK_SIZE) {
    const chunk = top30.slice(i, i + CHUNK_SIZE);

    try {
      const aliases = chunk.map((r, j) => `
        repo${j}: repository(owner: "${r.owner}", name: "${r.name}") {
          description
          stargazerCount
          forkCount
          updatedAt
          releases(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) {
            nodes {
              tagName
              name
              description
              publishedAt
            }
          }
          defaultBranchRef {
            target {
              ... on Commit {
                history(first: 3) {
                  nodes {
                    messageHeadline
                    oid
                    authoredDate
                    author {
                      user { login }
                      name
                    }
                  }
                }
              }
            }
          }
        }`);

      const query = `query { ${aliases.join('\n')} }`;
      const result = await client.graphql(query);

      for (let j = 0; j < chunk.length; j++) {
        const repo = chunk[j];
        const data = result[`repo${j}`];

        const release = data?.releases?.nodes?.[0] || null;
        const commits = (data?.defaultBranchRef?.target?.history?.nodes || []).map(c => ({
          message: c.messageHeadline,
          sha: c.oid?.substring(0, 7),
          date: c.authoredDate,
          author: c.author?.user?.login || c.author?.name || 'unknown'
        }));

        repoSnapshots.push({
          owner: repo.owner,
          name: repo.name,
          full_name: repo.full_name,
          description: data?.description || repo.description || '',
          language: repo.language,
          stars: data?.stargazerCount || 0,
          forks: data?.forkCount || 0,
          url: repo.url,
          updated_at: data?.updatedAt || repo.updated_at,
          latest_release: release ? {
            tag: release.tagName,
            name: release.name,
            body: release.description || '',
            date: release.publishedAt
          } : null,
          recent_commits: commits
        });
      }
    } catch (error) {
      console.error(`Error fetching dashboard batch (chunk ${i}):`, error.message);
      // Fallback: include repos from REST data without GraphQL details
      for (const repo of chunk) {
        repoSnapshots.push({
          owner: repo.owner,
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description || '',
          language: repo.language,
          stars: 0,
          forks: 0,
          url: repo.url,
          updated_at: repo.updated_at,
          latest_release: null,
          recent_commits: []
        });
      }
    }
  }

  // Sort: releases first (by release date desc), then by most recent activity
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  repoSnapshots.sort((a, b) => {
    const aDate = a.latest_release?.date || a.recent_commits[0]?.date || a.updated_at;
    const bDate = b.latest_release?.date || b.recent_commits[0]?.date || b.updated_at;
    const aHasRelease = a.latest_release ? 1 : 0;
    const bHasRelease = b.latest_release ? 1 : 0;
    if (aHasRelease !== bHasRelease) return bHasRelease - aHasRelease;
    return new Date(bDate) - new Date(aDate);
  });

  const withRelease = repoSnapshots.filter(r => r.latest_release).length;
  const active7d = repoSnapshots.filter(r => {
    const latestDate = r.recent_commits[0]?.date || r.latest_release?.date || r.updated_at;
    return latestDate && latestDate >= sevenDaysAgo;
  }).length;

  return {
    summary: {
      total_starred: allStarred.length,
      shown: repoSnapshots.length,
      with_release: withRelease,
      active_7d: active7d
    },
    repos: repoSnapshots
  };
}
```

Update the export block:

```js
module.exports = {
  checkStarredBatch,
  getStarredRepos,
  getStarredRepoActivityBatch,
  getStarredDashboard
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "Tests:|Test Suites:"`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add github-client.js __tests__/github-client.test.js
git commit -m "feat: add getStarredDashboard() with GraphQL repo snapshots"
```

---

### Task 2: Backend — `/api/starred-dashboard` route in server.js

**Files:**
- Modify: `server.js` — add new route
- Modify: `__tests__/server-routes.test.js` — add route test

- [ ] **Step 1: Write failing test for `/api/starred-dashboard` route**

Add a new mock and test to `__tests__/server-routes.test.js`. First add the mock function at the top with the other mocks:

```js
const mockGetStarredDashboard = jest.fn();
```

Update the `jest.mock('../github-client', ...)` to include it:

```js
jest.mock('../github-client', () => ({
  checkStarredBatch: mockCheckStarredBatch,
  getStarredRepos: mockGetStarredRepos,
  getStarredRepoActivityBatch: mockGetStarredRepoActivityBatch,
  getStarredDashboard: mockGetStarredDashboard
}));
```

Then add the test (after the existing `/api/trending caching` describe block):

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns=server-routes 2>&1 | tail -10`
Expected: FAIL — 404 or route not found

- [ ] **Step 3: Add `/api/starred-dashboard` route to server.js**

Add this route in `server.js` after the existing `/api/starred-activity` route:

```js
// Starred dashboard (per-repo snapshot with releases + commits)
app.get('/api/starred-dashboard', async (req, res) => {
  try {
    if (!GITHUB_TOKEN) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "Tests:|Test Suites:"`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server.js __tests__/server-routes.test.js
git commit -m "feat: add /api/starred-dashboard route"
```

---

### Task 3: Frontend — Dashboard HTML structure and CSS

**Files:**
- Modify: `public/index.html` — update Star tab HTML, add Trending filter button
- Modify: `public/styles.css` — add dashboard styles

- [ ] **Step 1: Update `public/index.html`**

Replace the Star tab content (`<div id="tab-starred">` section) with:

```html
<div id="tab-starred" class="tab-content">
    <div id="starred-loading" class="loading hidden">
        <div class="spinner"></div>
        <p>正在加载 Star 仪表盘...</p>
    </div>
    <div id="starred-summary" class="star-summary hidden"></div>
    <div id="starred-dashboard" class="star-dashboard"></div>
</div>
```

Add the Star filter button in the Trending filters section, after the refresh button:

```html
<button id="starredFilterBtn" class="filter-btn" title="只看我 Star 过的项目">⭐ 只看我的 Star</button>
```

Change the Star tab button text:

```html
<button class="tab-btn" data-tab="starred">我的 Star</button>
```

- [ ] **Step 2: Add dashboard CSS to `public/styles.css`**

Append these styles at the end of the file:

```css
/* ─── Star Dashboard ─────────────────────────────────────────────── */

.star-summary {
    display: flex;
    gap: 1.5rem;
    padding: 1rem 1.5rem;
    background: var(--card-background);
    border-radius: 10px;
    margin-bottom: 1.5rem;
    border: 1px solid var(--border-color);
    flex-wrap: wrap;
}

.star-summary-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    color: var(--text-secondary);
}

.star-summary-item strong {
    color: var(--text-primary);
    font-size: 1.1rem;
}

.star-dashboard {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 1rem;
}

.star-repo-card {
    background: var(--card-background);
    border-radius: 10px;
    padding: 1rem 1.2rem;
    border: 1px solid var(--border-color);
    transition: border-color 0.2s;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.star-repo-card:hover {
    border-color: var(--accent-color);
}

.star-repo-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
}

.star-repo-title {
    font-size: 1rem;
    font-weight: 600;
}

.star-repo-title a {
    color: var(--link-color);
    text-decoration: none;
}

.star-repo-title a:hover {
    text-decoration: underline;
}

.star-repo-lang {
    font-size: 0.8rem;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 0.3rem;
    white-space: nowrap;
}

.star-repo-lang .lang-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
}

.star-repo-release {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    padding: 0.3rem 0.6rem;
    background: rgba(46, 160, 67, 0.12);
    border-radius: 6px;
    color: #2ea043;
    font-weight: 500;
}

.star-repo-release .release-time {
    color: var(--text-secondary);
    font-weight: 400;
}

.star-repo-desc {
    font-size: 0.85rem;
    color: var(--text-secondary);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.star-repo-commits {
    border-top: 1px solid var(--border-color);
    padding-top: 0.5rem;
    margin-top: 0.2rem;
}

.star-repo-commit {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
    padding: 0.15rem 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.star-repo-commit .commit-sha {
    color: var(--link-color);
    font-family: monospace;
    font-size: 0.75rem;
    flex-shrink: 0;
}

.star-repo-commit .commit-time {
    flex-shrink: 0;
    margin-left: auto;
    font-size: 0.75rem;
}

.star-repo-stars {
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-left: auto;
    white-space: nowrap;
}

.filter-btn {
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--card-background);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s;
}

.filter-btn:hover {
    border-color: var(--accent-color);
    color: var(--text-primary);
}

.filter-btn.active {
    background: var(--accent-color);
    color: white;
    border-color: var(--accent-color);
}

.activity-empty {
    text-align: center;
    padding: 3rem;
    color: var(--text-secondary);
    font-size: 1rem;
}
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "feat: add star dashboard HTML structure and CSS styles"
```

---

### Task 4: Frontend — Dashboard JavaScript logic

**Files:**
- Modify: `public/app.js` — rewrite Star tab loader, add Trending filter

- [ ] **Step 1: Replace `loadStarredActivity()` function in app.js**

Replace the existing `loadStarredActivity()` function and all related functions (`createActivityItem`, `getActionText`, `getDetailsHtml`) with the new dashboard loader:

```js
// Load starred dashboard
async function loadStarredActivity() {
    const loading = document.getElementById('starred-loading');
    const summaryEl = document.getElementById('starred-summary');
    const dashboardEl = document.getElementById('starred-dashboard');

    loading.classList.remove('hidden');
    summaryEl.classList.add('hidden');
    dashboardEl.innerHTML = '';

    try {
        const response = await fetch(`${API_BASE}/api/starred-dashboard`);
        const result = await response.json();

        if (!result.success) {
            dashboardEl.innerHTML = `<div class="activity-empty">${escapeHtml(result.data?.summary ? '' : (result.message || '加载失败'))}</div>`;
            return;
        }

        const { summary, repos } = result.data;

        if (repos.length === 0) {
            dashboardEl.innerHTML = '<div class="activity-empty">请配置 GitHub Token 以查看 Star 仪表盘</div>';
            return;
        }

        // Render summary
        summaryEl.innerHTML = `
            <div class="star-summary-item">⭐ <strong>${summary.total_starred}</strong> 个仓库</div>
            <div class="star-summary-item">📦 <strong>${summary.with_release}</strong> 个有新版本</div>
            <div class="star-summary-item">🔥 <strong>${summary.active_7d}</strong> 个本周活跃</div>
        `;
        summaryEl.classList.remove('hidden');

        // Render repo cards
        dashboardEl.innerHTML = repos.map(repo => createStarRepoCard(repo)).join('');
    } catch (error) {
        console.error('加载Star仪表盘失败:', error);
        dashboardEl.innerHTML = '<div class="activity-empty">加载失败</div>';
    } finally {
        loading.classList.add('hidden');
    }
}

// Create star repo card HTML
function createStarRepoCard(repo) {
    const languageColor = LANGUAGE_COLORS[repo.language] || '#8b949e';
    const repoHref = escapeAttr(repo.url);

    const releaseHtml = repo.latest_release
        ? `<div class="star-repo-release">
               📦 ${escapeHtml(repo.latest_release.tag)}
               <span class="release-time">${formatTimeAgo(repo.latest_release.date)}</span>
           </div>`
        : '';

    const commitsHtml = repo.recent_commits.length > 0
        ? `<div class="star-repo-commits">
               ${repo.recent_commits.map(c => `
                   <div class="star-repo-commit">
                       <span class="commit-sha">${escapeHtml(c.sha)}</span>
                       <span>${escapeHtml(c.message)}</span>
                       <span class="commit-time">${formatTimeAgo(c.date)}</span>
                   </div>
               `).join('')}
           </div>`
        : '';

    return `
        <div class="star-repo-card">
            <div class="star-repo-header">
                <div class="star-repo-title">
                    <a href="${repoHref}" target="_blank" rel="noopener">
                        ${escapeHtml(repo.owner)} / ${escapeHtml(repo.name)}
                    </a>
                </div>
                <div class="star-repo-lang">
                    ${repo.language ? `<span class="lang-dot" style="background:${languageColor}"></span>${escapeHtml(repo.language)}` : ''}
                    <span class="star-repo-stars">⭐ ${formatNumber(repo.stars)}</span>
                </div>
            </div>
            ${releaseHtml}
            ${repo.description ? `<div class="star-repo-desc">${escapeHtml(repo.description)}</div>` : ''}
            ${commitsHtml}
        </div>
    `;
}
```

- [ ] **Step 2: Add Trending Star filter logic**

Add this code near the `timeRangeSelect` initialization area (after `const refreshBtn = ...`):

```js
const starredFilterBtn = document.getElementById('starredFilterBtn');

if (starredFilterBtn) {
    // Restore from URL param
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('starred') === 'true') {
        starredFilterBtn.classList.add('active');
    }

    starredFilterBtn.addEventListener('click', () => {
        starredFilterBtn.classList.toggle('active');
        applyStarredFilter();
        // Persist to URL
        const url = new URL(window.location);
        if (starredFilterBtn.classList.contains('active')) {
            url.searchParams.set('starred', 'true');
        } else {
            url.searchParams.delete('starred');
        }
        window.history.replaceState({}, '', url);
    });
}

function applyStarredFilter() {
    const isActive = starredFilterBtn?.classList.contains('active');
    const filtered = isActive
        ? currentRepos.filter(r => starredStatus[`${r.author}/${r.name}`] === true)
        : currentRepos;
    displayRepositories(filtered);
    updateStats(filtered.length);
}
```

- [ ] **Step 3: Update `checkStarredStatus()` to re-apply filter**

At the end of the existing `checkStarredStatus()` function, after `displayRepositories(currentRepos)`, add:

```js
        applyStarredFilter();
```

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: star dashboard frontend + trending star filter"
```

---

### Task 5: Integration test and deploy

**Files:** None new — verify and deploy

- [ ] **Step 1: Run all tests**

Run: `npm test 2>&1 | grep -E "Tests:|Test Suites:"`
Expected: All tests PASS

- [ ] **Step 2: Commit any remaining changes, push**

```bash
git push origin main
```

- [ ] **Step 3: Deploy to NAS**

```bash
scp -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa \
  github-client.js server.js public/app.js public/index.html public/styles.css \
  yt4215481@192.168.31.14:/vol1/1000/docker/github-trending/
ssh -i ~/.claude/skills/ssh-manager/192.168.31.14/id_rsa yt4215481@192.168.31.14 \
  "cd /vol1/1000/docker/github-trending && docker compose up -d --build"
```

- [ ] **Step 4: Verify on NAS**

1. Visit `http://192.168.31.14:3003` — Star tab shows dashboard with summary bar and repo cards
2. Click "⭐ 只看我的 Star" on Trending page — list filters correctly
3. Refresh with `?starred=true` URL param — filter persists
4. No token — Star tab shows friendly message
