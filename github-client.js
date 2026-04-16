const { Octokit } = require('@octokit/rest');
const { graphql } = require('@octokit/graphql');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

let octokit = null;
let graphqlWithAuth = null;

// ─── In-memory TTL cache ───────────────────────────────────────────────────

const cache = new Map();

function setCache(key, value, ttlMs) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

// Periodic cleanup every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expires) cache.delete(key);
  }
}, 10 * 60 * 1000);

// ─── Client initialization ─────────────────────────────────────────────────

function getClient() {
  if (!GITHUB_TOKEN) return null;
  if (octokit) return { octokit, graphql: graphqlWithAuth };

  octokit = new Octokit({ auth: GITHUB_TOKEN });

  graphqlWithAuth = graphql.defaults({
    headers: { authorization: `token ${GITHUB_TOKEN}` }
  });

  return { octokit, graphql: graphqlWithAuth };
}

// ─── Batch star status check (1 GraphQL query instead of 20 REST calls) ────

async function checkStarredBatch(repos) {
  if (!GITHUB_TOKEN || !repos || repos.length === 0) {
    return (repos || []).map(r => ({ owner: r.owner, name: r.name, starred: null }));
  }

  const cacheKey = `starred-status:${repos.map(r => `${r.owner}/${r.name}`).sort().join(',')}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = getClient();

  try {
    const aliases = repos.map((r, i) =>
      `repo${i}: repository(owner: "${r.owner}", name: "${r.name}") { viewerHasStarred }`
    );
    const query = `query { ${aliases.join('\n')} }`;

    const result = await client.graphql(query);

    const data = repos.map((r, i) => ({
      owner: r.owner,
      name: r.name,
      starred: result[`repo${i}`]?.viewerHasStarred ?? null
    }));

    setCache(cacheKey, data, 5 * 60 * 1000);
    return data;
  } catch (error) {
    console.error('Error in checkStarredBatch:', error.message);
    return repos.map(r => ({ owner: r.owner, name: r.name, starred: null }));
  }
}

// ─── Starred repos list (Octokit REST) ─────────────────────────────────────

async function getStarredRepos() {
  if (!GITHUB_TOKEN) return [];

  const cacheKey = 'starred-repos';
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = getClient();

  try {
    const response = await client.octokit.rest.activity.listReposStarredByAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
      direction: 'desc'
    });

    const data = response.data.map(repo => ({
      owner: repo.owner.login,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      descriptionZh: repo.description,
      language: repo.language,
      url: repo.html_url,
      updated_at: repo.updated_at
    }));

    setCache(cacheKey, data, 5 * 60 * 1000);
    return data;
  } catch (error) {
    console.error('Error fetching starred repos:', error.message);
    return [];
  }
}

// ─── Batch repo activity (GraphQL releases + commits) ──────────────────────

async function getStarredRepoActivityBatch(repos) {
  if (!GITHUB_TOKEN || !repos || repos.length === 0) return [];

  const client = getClient();
  const CHUNK_SIZE = 15;
  const allEvents = [];

  for (let i = 0; i < repos.length; i += CHUNK_SIZE) {
    const chunk = repos.slice(i, i + CHUNK_SIZE);

    try {
      const aliases = chunk.map((r, j) => {
        const idx = `repo${j}`;
        return `
        ${idx}: repository(owner: "${r.owner}", name: "${r.name}") {
          releases(first: 5, orderBy: {field: CREATED_AT, direction: DESC}) {
            nodes {
              tagName
              name
              body
              publishedAt
              createdAt
              author { login avatarUrl }
            }
          }
          defaultBranchRef {
            target {
              ... on Commit {
                history(first: 5) {
                  nodes {
                    messageHeadline
                    oid
                    authoredDate
                    author {
                      user { login avatarUrl }
                      name
                    }
                  }
                }
              }
            }
          }
        }`;
      });

      const query = `query { ${aliases.join('\n')} }`;
      const result = await client.graphql(query);

      for (let j = 0; j < chunk.length; j++) {
        const repo = chunk[j];
        const repoData = result[`repo${j}`];
        if (!repoData) continue;

        // Process releases
        const releaseNodes = repoData.releases?.nodes || [];
        for (const release of releaseNodes) {
          allEvents.push({
            type: 'ReleaseEvent',
            repo: `${repo.owner}/${repo.name}`,
            actor: release.author?.login || repo.owner,
            avatar: release.author?.avatarUrl || '',
            created_at: release.publishedAt || release.createdAt,
            details: { tag: release.tagName, name: release.name, body: release.body }
          });
        }

        // Process commits
        const commitNodes = repoData.defaultBranchRef?.target?.history?.nodes || [];
        for (const commit of commitNodes) {
          allEvents.push({
            type: 'PushEvent',
            repo: `${repo.owner}/${repo.name}`,
            actor: commit.author?.user?.login || commit.author?.name || 'unknown',
            avatar: commit.author?.user?.avatarUrl || '',
            created_at: commit.authoredDate,
            details: {
              message: commit.messageHeadline,
              sha: commit.oid?.substring(0, 7)
            }
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching activity batch (chunk ${i}):`, error.message);
    }
  }

  allEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return allEvents;
}

module.exports = {
  checkStarredBatch,
  getStarredRepos,
  getStarredRepoActivityBatch
};
