const API_BASE = window.location.origin;

// Tab handling
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${tab}`).classList.add('active');

        if (tab === 'starred') {
            loadStarredActivity();
        }
    });
});

// Load starred activity
async function loadStarredActivity() {
    const container = document.getElementById('starred-activity');
    const loading = document.getElementById('starred-loading');

    loading.classList.remove('hidden');
    container.innerHTML = '';

    try {
        const response = await fetch(`${API_BASE}/api/starred-activity`);
        const result = await response.json();

        if (!result.success) {
            container.innerHTML = `<div class="activity-empty">${result.message || '加载失败'}</div>`;
            return;
        }

        if (result.data.length === 0) {
            container.innerHTML = '<div class="activity-empty">暂无动态</div>';
            return;
        }

        container.innerHTML = result.data.map(event => createActivityItem(event)).join('');
    } catch (error) {
        console.error('加载Star动态失败:', error);
        container.innerHTML = '<div class="activity-empty">加载失败</div>';
    } finally {
        loading.classList.add('hidden');
    }
}

// Create activity item HTML
function createActivityItem(event) {
    const timeAgo = formatTimeAgo(event.created_at);
    const actionText = getActionText(event);
    const detailsHtml = getDetailsHtml(event);

    return `
        <div class="activity-item">
            <a href="https://github.com/${event.repo}" target="_blank" class="activity-repo">${event.repo}</a>
            <div class="activity-details">
                <strong>${actionText}</strong>
                ${detailsHtml ? ` · ${detailsHtml}` : ''}
            </div>
            <div class="activity-time">${timeAgo}</div>
        </div>
    `;
}

// Get action text based on event type
function getActionText(event) {
    const actions = {
        'PushEvent': '提交代码',
        'PullRequestEvent': `${event.details.action} PR`,
        'IssuesEvent': `${event.details.action} Issue`,
        'ReleaseEvent': '发布新版本',
        'CreateEvent': `创建 ${event.details.type}`,
        'DeleteEvent': `删除 ${event.details.type}`
    };
    return actions[event.type] || event.type;
}

// Get details HTML based on event type
function getDetailsHtml(event) {
    const d = event.details;
    if (d.message) return d.message.substring(0, 80) + (d.message.length > 80 ? '...' : '');
    if (d.tag) return `🏷️ ${d.tag}` + (d.name ? ` - ${d.name}` : '');
    if (d.title) return `📌 ${d.title}`;
    if (d.name) return `${d.type}: ${d.name}`;
    return '';
}

// Format time ago
function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`;
    return date.toLocaleDateString('zh-CN');
}

// Language colors mapping
const LANGUAGE_COLORS = {
    'JavaScript': '#f1e05a',
    'TypeScript': '#3178c6',
    'Python': '#3572A5',
    'Java': '#b07219',
    'Go': '#00ADD8',
    'Rust': '#dea584',
    'C++': '#f34b7d',
    'C': '#555555',
    'PHP': '#4F5D95',
    'Ruby': '#701516',
    'Swift': '#F05138',
    'Kotlin': '#A97BFF',
    'Dart': '#00B4AB',
    'Shell': '#89e051',
    'Vue': '#41b883',
    'React': '#61dafb',
};

// DOM Elements
const timeRangeSelect = document.getElementById('timeRange');
const languageSelect = document.getElementById('language');
const refreshBtn = document.getElementById('refreshBtn');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const statsEl = document.getElementById('stats');
const repoCountEl = document.getElementById('repoCount');
const repositoriesEl = document.getElementById('repositories');

let currentRepos = [];
let starredStatus = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadLanguages();
    fetchTrending();

    // Event listeners
    timeRangeSelect.addEventListener('change', fetchTrending);
    languageSelect.addEventListener('change', fetchTrending);
    refreshBtn.addEventListener('click', fetchTrending);
});

// Silent prefetch all periods for ranking history
async function prefetchAllPeriods() {
    try {
        await fetch(`${API_BASE}/api/prefetch-all`);
    } catch (error) {
        console.warn('Prefetch failed:', error);
    }
}

// Load available languages
async function loadLanguages() {
    try {
        const response = await fetch(`${API_BASE}/api/languages`);
        const languages = await response.json();

        languageSelect.innerHTML = languages
            .map(lang => `<option value="${lang.value}">${lang.label}</option>`)
            .join('');
    } catch (error) {
        console.error('加载语言列表失败:', error);
    }
}

// Fetch trending repositories
async function fetchTrending() {
    const since = timeRangeSelect.value;
    const language = languageSelect.value;

    showLoading();
    hideError();

    try {
        const response = await fetch(
            `${API_BASE}/api/trending?since=${since}&language=${encodeURIComponent(language)}`
        );

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || '获取热门项目失败');
        }

        currentRepos = result.data;
        displayRepositories(currentRepos);
        updateStats(currentRepos.length);

        // Check starred status
        await checkStarredStatus(currentRepos);

        // Silent prefetch all periods for ranking history
        prefetchAllPeriods();
    } catch (error) {
        console.error('获取热门项目出错:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// Check starred status for repos
async function checkStarredStatus(repos) {
    try {
        const response = await fetch(`${API_BASE}/api/check-starred`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                repos: repos.map(r => ({ owner: r.author, name: r.name }))
            })
        });

        const result = await response.json();
        if (result.success && result.data) {
            result.data.forEach(item => {
                const key = `${item.owner}/${item.name}`;
                starredStatus[key] = item.starred;
            });

            // Re-render with star status
            displayRepositories(currentRepos);
        }
    } catch (error) {
        console.error('检查star状态失败:', error);
    }
}

// Display repositories
function displayRepositories(repos) {
    if (!repos || repos.length === 0) {
        repositoriesEl.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                <p style="font-size: 1.2rem;">未找到热门项目</p>
                <p style="margin-top: 0.5rem;">请尝试选择不同的时间范围或编程语言</p>
            </div>
        `;
        return;
    }

    repositoriesEl.innerHTML = repos
        .map((repo, index) => createRepoCard(repo, index + 1))
        .join('');
}

// Create ranking change indicator
function createRankingChange(rankingChange) {
    if (!rankingChange || rankingChange.isNew) {
        return '<span class="ranking-change new">🆕 新上榜</span>';
    }

    const { change } = rankingChange;

    if (change === 0) {
        return '<span class="ranking-change unchanged">— 保持</span>';
    }

    if (change > 0) {
        return `<span class="ranking-change up">↑ ${change}</span>`;
    }

    return `<span class="ranking-change down">↓ ${Math.abs(change)}</span>`;
}

// Create star status indicator
function createStarStatus(author, name) {
    const key = `${author}/${name}`;
    const starred = starredStatus[key];

    if (starred === null || starred === undefined) {
        return ''; // No token configured or status unknown
    }

    if (starred) {
        return '<span class="star-status starred" title="已Star">⭐ 已Star</span>';
    }

    return `<a href="https://github.com/${author}/${name}" target="_blank" class="star-status not-starred" title="点击前往Star">☆ Star</a>`;
}

// Create repository card HTML
function createRepoCard(repo, rank) {
    const languageColor = LANGUAGE_COLORS[repo.language] || '#8b949e';

    return `
        <div class="repo-card">
            <div class="repo-header">
                <div class="repo-rank">${rank}</div>
                <div class="repo-info">
                    <div class="repo-title">
                        <a href="${repo.url}" target="_blank" rel="noopener">
                            ${repo.author} / ${repo.name}
                        </a>
                        ${repo.language ? `<span class="repo-language">${repo.language}</span>` : ''}
                        ${createRankingChange(repo.rankingChange)}
                        ${createStarStatus(repo.author, repo.name)}
                    </div>
                    ${repo.descriptionZh || repo.description ? `<p class="repo-description">${escapeHtml(repo.descriptionZh || repo.description)}</p>` : ''}
                    <div class="repo-stats">
                        ${createStat('⭐', 'stars', formatNumber(repo.stars), '总星标数')}
                        ${createStat('🔱', 'forks', formatNumber(repo.forks), 'Fork数')}
                        ${repo.currentPeriodStars ? createStat('📈', 'current-stars', `+${formatNumber(repo.currentPeriodStars)}`, '本周期新增星标') : ''}
                        ${repo.builtBy && repo.builtBy.length > 0 ? createBuiltBy(repo.builtBy) : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Create stat element
function createStat(icon, className, value, title) {
    return `
        <div class="stat ${className}" title="${title}">
            <span>${icon}</span>
            <span class="stat-value">${value}</span>
        </div>
    `;
}

// Create built by section
function createBuiltBy(contributors) {
    const avatars = contributors
        .slice(0, 5)
        .map(contributor => `
            <a href="${contributor.url}" target="_blank" rel="noopener" title="${contributor.username}">
                <img
                    src="${contributor.avatar}"
                    alt="${contributor.username}"
                    style="width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--card-background);"
                />
            </a>
        `)
        .join('');

    return `
        <div class="stat" title="贡献者">
            <span>👥</span>
            <div style="display: flex; gap: 4px; align-items: center;">
                ${avatars}
            </div>
        </div>
    `;
}

// Update stats
function updateStats(count) {
    repoCountEl.textContent = count;
    statsEl.classList.remove('hidden');
}

// Show/hide loading
function showLoading() {
    loadingEl.classList.remove('hidden');
    repositoriesEl.innerHTML = '';
    statsEl.classList.add('hidden');
}

function hideLoading() {
    loadingEl.classList.add('hidden');
}

// Show/hide error
function showError(message) {
    errorEl.textContent = `错误: ${message}`;
    errorEl.classList.remove('hidden');
}

function hideError() {
    errorEl.classList.add('hidden');
}

// Utility functions
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
