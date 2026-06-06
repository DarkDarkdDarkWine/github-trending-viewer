const API_BASE = window.location.origin;
const TRANSLATION_STREAM_TIMEOUT_MS = 45000;

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
        if (tab === 'reports') {
            loadReports();
        }
        if (tab === 'settings') {
            loadProviders();
        }
    });
});

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
const refreshBtn = document.getElementById('refreshBtn');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const statsEl = document.getElementById('stats');
const repoCountEl = document.getElementById('repoCount');
const repositoriesEl = document.getElementById('repositories');
const repoSearchInput = document.getElementById('repoSearch');
const sortModeSelect = document.getElementById('sortMode');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const activeFilterSummaryEl = document.getElementById('activeFilterSummary');

let currentRepos = [];
let starredStatus = {};
let currentTrendingMeta = null;
let translationRunId = 0;

// Star filter button for Trending page
const starredFilterBtn = document.getElementById('starredFilterBtn');
const recommendedSortBtn = document.getElementById('recommendedSortBtn');

if (starredFilterBtn) {
    // Restore from URL param
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('starred') === 'true') {
        starredFilterBtn.classList.add('active');
    }

    starredFilterBtn.addEventListener('click', () => {
        starredFilterBtn.classList.toggle('active');
        setUrlParam('starred', starredFilterBtn.classList.contains('active') ? 'true' : '');
        updateVisibleRepositories();
    });
}

if (recommendedSortBtn) {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('recommended') === 'true') {
        recommendedSortBtn.classList.add('active');
    }

    recommendedSortBtn.addEventListener('click', () => {
        const active = !recommendedSortBtn.classList.contains('active');
        setRecommendedSortActive(active);

        if (active && !hasRecommendationScores()) {
            fetchTrending();
            return;
        }
        updateVisibleRepositories();
    });
}

function applyStarredFilter() {
    updateVisibleRepositories();
}

function updateVisibleRepositories() {
    const visible = getVisibleRepos();
    displayRepositories(visible);
    updateStats(visible.length);
    updateRecommendedSortButton();
    updateClearFiltersButton();
}

function getVisibleRepos() {
    let items = currentRepos.map((repo, index) => ({ repo, index }));

    if (starredFilterBtn?.classList.contains('active')) {
        items = items.filter(({ repo }) => starredStatus[`${repo.author}/${repo.name}`] === true);
    }

    const query = getSearchQuery();
    if (query) {
        items = items.filter(({ repo }) => repoMatchesQuery(repo, query));
    }

    return sortVisibleItems(items).map(item => item.repo);
}

function updateRecommendedSortButton() {
    if (!recommendedSortBtn) return;
    const hasScores = hasRecommendationScores();
    recommendedSortBtn.title = hasScores
        ? '按 AI 推荐分排序'
        : '暂无推荐分，可在 AI 设置后手动刷新推荐';
}

function initializeListTools() {
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q') || '';
    const sort = urlParams.get('sort') || 'rank';

    if (repoSearchInput) {
        repoSearchInput.value = query;
        repoSearchInput.addEventListener('input', () => {
            setUrlParam('q', repoSearchInput.value.trim());
            updateVisibleRepositories();
        });
    }

    if (sortModeSelect) {
        if ([...sortModeSelect.options].some(option => option.value === sort)) {
            sortModeSelect.value = sort;
        }
        if (recommendedSortBtn?.classList.contains('active')) {
            sortModeSelect.value = 'recommendation';
        }
        if (sortModeSelect.value === 'recommendation') {
            recommendedSortBtn?.classList.add('active');
        }
        sortModeSelect.addEventListener('change', () => {
            const sortMode = sortModeSelect.value;
            setRecommendedSortActive(sortMode === 'recommendation', false);
            setUrlParam('sort', sortMode === 'rank' ? '' : sortMode);

            if (sortMode === 'recommendation' && !hasRecommendationScores()) {
                fetchTrending();
                return;
            }
            updateVisibleRepositories();
        });
    }

    clearFiltersBtn?.addEventListener('click', () => {
        if (repoSearchInput) repoSearchInput.value = '';
        if (sortModeSelect) sortModeSelect.value = 'rank';
        starredFilterBtn?.classList.remove('active');
        recommendedSortBtn?.classList.remove('active');
        ['q', 'sort', 'starred', 'recommended'].forEach(key => setUrlParam(key, ''));
        updateVisibleRepositories();
    });
}

function setRecommendedSortActive(active, syncSortSelect = true) {
    recommendedSortBtn?.classList.toggle('active', active);
    setUrlParam('recommended', active ? 'true' : '');

    if (!syncSortSelect || !sortModeSelect) return;
    sortModeSelect.value = active ? 'recommendation' : 'rank';
    setUrlParam('sort', active ? 'recommendation' : '');
}

function setUrlParam(key, value) {
    const url = new URL(window.location);
    if (value) {
        url.searchParams.set(key, value);
    } else {
        url.searchParams.delete(key);
    }
    window.history.replaceState({}, '', url);
}

function getSearchQuery() {
    return repoSearchInput?.value.trim().toLowerCase() || '';
}

function repoMatchesQuery(repo, query) {
    return [
        repo.author,
        repo.name,
        repo.language,
        repo.description,
        `${repo.author}/${repo.name}`
    ].some(value => String(value || '').toLowerCase().includes(query));
}

function sortVisibleItems(items) {
    const sortMode = recommendedSortBtn?.classList.contains('active')
        ? 'recommendation'
        : (sortModeSelect?.value || 'rank');

    const valueFor = {
        'period-stars': repo => Number(repo.currentPeriodStars || 0),
        stars: repo => Number(repo.stars || 0),
        forks: repo => Number(repo.forks || 0),
        recommendation: repo => typeof repo.matchScore === 'number' ? repo.matchScore : -1
    }[sortMode];

    if (!valueFor) return items;

    return [...items].sort((a, b) => {
        const diff = valueFor(b.repo) - valueFor(a.repo);
        return diff || a.index - b.index;
    });
}

function hasRecommendationScores() {
    return currentRepos.some(repo => typeof repo.matchScore === 'number');
}

function updateClearFiltersButton() {
    if (!clearFiltersBtn) return;
    clearFiltersBtn.disabled = !hasActiveListFilters();
}

function hasActiveListFilters() {
    return Boolean(
        getSearchQuery() ||
        starredFilterBtn?.classList.contains('active') ||
        recommendedSortBtn?.classList.contains('active') ||
        (sortModeSelect && sortModeSelect.value !== 'rank')
    );
}

function updateActiveFilterSummary(count) {
    if (!activeFilterSummaryEl) return;
    const parts = [];
    if (getSearchQuery()) parts.push(`搜索 "${repoSearchInput.value.trim()}"`);
    if (starredFilterBtn?.classList.contains('active')) parts.push('只看 Star');
    if (recommendedSortBtn?.classList.contains('active')) {
        parts.push('推荐排序');
    } else if (sortModeSelect && sortModeSelect.value !== 'rank') {
        parts.push(sortModeSelect.options[sortModeSelect.selectedIndex].textContent);
    }
    activeFilterSummaryEl.textContent = parts.length
        ? `${parts.join(' · ')} · ${count}/${currentRepos.length}`
        : '未应用筛选';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeListTools();
    fetchTrending();

    timeRangeSelect.addEventListener('change', fetchTrending);
    refreshBtn.addEventListener('click', fetchTrending);
});

// Stream translations and update each card as results arrive in order
async function streamTranslations(repos) {
    const runId = String(++translationRunId);
    const texts = repos
        .map((repo, index) => {
            if (!repo.description) return null;
            return { index, text: repo.description };
        })
        .filter(Boolean);

    if (texts.length === 0) return;

    // Add translation animation to all cards that will be translated
    for (const { index } of texts) {
        const repo = repos[index];
        const card = repo && document.querySelector(`[data-repo-key="${escapeAttr(`${repo.author}/${repo.name}`)}"]`);
        const el = card && card.querySelector('.repo-description');
        if (el) {
            el.classList.add('translating');
            el.classList.remove('translation-done', 'translation-failed');
            el.setAttribute('data-original', el.textContent);
            el.setAttribute('data-translation-run', runId);
        }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSLATION_STREAM_TIMEOUT_MS);

    try {
        const response = await fetch(`${API_BASE}/api/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts }),
            signal: controller.signal
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                applyTranslationEvent(line, repos, runId);
            }
        }

        if (buffer.trim()) {
            applyTranslationEvent(buffer, repos, runId);
        }
    } catch (error) {
        console.warn('Translation stream failed:', error);
        const message = error.name === 'AbortError'
            ? '翻译超时，已显示原文'
            : '翻译连接失败，已显示原文';
        finishPendingTranslations(runId, message);
    } finally {
        clearTimeout(timeoutId);
        finishPendingTranslations(runId, '翻译未返回，已显示原文');
    }
}

function applyTranslationEvent(line, repos, runId) {
    if (!line.startsWith('data: ')) return;

    let data;
    try {
        data = JSON.parse(line.slice(6));
    } catch (error) {
        console.warn('Invalid translation stream event:', error);
        return;
    }

    const repo = repos[data.index];
    const card = repo && document.querySelector(`[data-repo-key="${escapeAttr(`${repo.author}/${repo.name}`)}"]`);
    const el = card && card.querySelector(`.repo-description[data-translation-run="${runId}"]`);
    if (!el || !el.classList.contains('translating')) return;

    el.classList.remove('translating');
    el.removeAttribute('data-translation-run');

    if (data.error || !data.translation) {
        const original = el.getAttribute('data-original');
        if (original) el.textContent = original;
        el.classList.add('translation-failed');
        el.title = `翻译失败: ${data.message || '未知错误'}`;
        return;
    }

    el.textContent = data.translation;
    el.classList.add('translation-done');
    el.title = '';
}

function finishPendingTranslations(runId, message) {
    document
        .querySelectorAll(`.repo-description.translating[data-translation-run="${runId}"]`)
        .forEach(el => {
            const original = el.getAttribute('data-original');
            if (original) el.textContent = original;
            el.classList.remove('translating');
            el.classList.add('translation-failed');
            el.removeAttribute('data-translation-run');
            el.title = message;
        });
}

// Fetch trending repositories
async function fetchTrending() {
    const since = timeRangeSelect.value;
    const personalize = recommendedSortBtn?.classList.contains('active');

    showLoading();
    hideError();

    try {
        const query = new URLSearchParams({ since });
        if (personalize) query.set('personalize', '1');
        const response = await fetch(`${API_BASE}/api/trending?${query.toString()}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || '获取热门项目失败');
        }

        currentRepos = result.data;
        currentTrendingMeta = result.meta || null;
        updateVisibleRepositories();

        await checkStarredStatus(currentRepos);

        streamTranslations(currentRepos);
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

            updateVisibleRepositories();
        }
    } catch (error) {
        console.error('检查star状态失败:', error);
    }
}

// Display repositories
function displayRepositories(repos) {
    if (!repos || repos.length === 0) {
        const hasFilters = currentRepos.length > 0 && hasActiveListFilters();
        repositoriesEl.innerHTML = `
            <div class="activity-empty">
                <div>
                    <p>${hasFilters ? '没有匹配当前筛选的项目' : '未找到热门项目'}</p>
                    <p>${hasFilters ? '清除筛选或换一个关键词试试' : '请尝试选择不同的时间范围'}</p>
                </div>
            </div>
        `;
        return;
    }

    const staleBanner = currentTrendingMeta?.stale
        ? `<div class="stale-banner">抓取异常，正在显示 ${formatTimeAgo(currentTrendingMeta.lastSuccess)} 的缓存数据</div>`
        : '';

    repositoriesEl.innerHTML = staleBanner + repos
        .map((repo, index) => createRepoCard(repo, index + 1))
        .join('');
}

// Create ranking change indicator
function createRankingChange(rankingChange) {
    if (!rankingChange || rankingChange.isNew) {
        return '<span class="ranking-change new">新上榜</span>';
    }

    const { change } = rankingChange;

    if (change === 0) {
        return '<span class="ranking-change unchanged">保持</span>';
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
        return '';
    }

    if (starred) {
        return '<span class="star-status starred" title="已Star">已 Star</span>';
    }

    const href = escapeAttr(`https://github.com/${author}/${name}`);
    return `<a href="${href}" target="_blank" class="star-status not-starred" title="点击前往Star">Star</a>`;
}

// Create recommendation score badge
function createMatchBadge(repo) {
    if (typeof repo.matchScore !== 'number') return '';
    const tier = repo.matchScore >= 75 ? 'high'
        : repo.matchScore >= 50 ? 'mid'
            : 'low';
    return `<span class="match-badge ${tier}" title="${escapeAttr(repo.matchReason || '')}">推荐 ${repo.matchScore}</span>`;
}

// Create repository card HTML
function createRepoCard(repo, rank) {
    const repoHref = escapeAttr(repo.url);
    const authorDisplay = escapeHtml(repo.author);
    const nameDisplay = escapeHtml(repo.name);
    const languageDisplay = repo.language ? escapeHtml(repo.language) : '';
    const repoKey = escapeAttr(`${repo.author}/${repo.name}`);
    const badges = [
        languageDisplay ? `<span class="repo-language">${languageDisplay}</span>` : '',
        createMatchBadge(repo),
        createRankingChange(repo.rankingChange)
    ].join('');

    return `
        <div class="repo-card" data-repo-key="${repoKey}">
            <div class="repo-header">
                <div class="repo-rank">${rank}</div>
                <div class="repo-info">
                    <div class="repo-topline">
                        <div class="repo-title">
                            <a href="${repoHref}" target="_blank" rel="noopener">
                                ${authorDisplay} / ${nameDisplay}
                            </a>
                            <div class="repo-badges">${badges}</div>
                        </div>
                        <div class="repo-actions">
                            ${createStarStatus(repo.author, repo.name)}
                        </div>
                    </div>
                    ${repo.description ? `<p class="repo-description">${escapeHtml(repo.description)}</p>` : ''}
                    <div class="repo-stats">
                        ${createStat('Stars', 'stars', formatNumber(repo.stars), '总星标数')}
                        ${createStat('Forks', 'forks', formatNumber(repo.forks), 'Fork数')}
                        ${repo.currentPeriodStars ? createStat('新增', 'current-stars', `+${formatNumber(repo.currentPeriodStars)}`, '本周期新增星标') : ''}
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
            <span class="stat-label">${icon}</span>
            <span class="stat-value">${value}</span>
        </div>
    `;
}

// Create built by section
function createBuiltBy(contributors) {
    const contributorNames = contributors
        .slice(0, 5)
        .map(contributor => contributor.username)
        .filter(Boolean)
        .join(', ');
    const avatars = contributors
        .slice(0, 5)
        .map(contributor => {
            const href = escapeAttr(contributor.url);
            const src = escapeAttr(contributor.avatar);
            const username = escapeAttr(contributor.username);
            return `
            <a href="${href}" target="_blank" rel="noopener" title="${username}" tabindex="-1" aria-hidden="true">
                    <img src="${src}" alt="" />
                </a>
        `;
        })
        .join('');

    return `
        <div class="stat" title="贡献者">
            <span class="stat-label">Built by</span>
            <div class="built-by" aria-label="贡献者：${escapeAttr(contributorNames)}">
                ${avatars}
            </div>
        </div>
    `;
}

// Update stats
function updateStats(count) {
    repoCountEl.textContent = count;
    statsEl.classList.remove('hidden');
    updateActiveFilterSummary(count);
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

// Escape for HTML text content
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Escape for HTML attribute values (handles double quotes which escapeHtml does not)
function escapeAttr(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ─── 趋势报告 ───────────────────────────────────────────────────────────────

const reportsLoading = document.getElementById('reports-loading');
const reportsList = document.getElementById('reports-list');
const reportDetail = document.getElementById('report-detail');
const reportDetailContent = document.getElementById('report-detail-content');
document.getElementById('reportBackBtn').addEventListener('click', showReportList);

const REPORT_TYPE_LABEL = { daily: '日报', weekly: '周报', monthly: '月报' };
const STATUS_LABEL = { pending: '生成中', done: '已完成', failed: '生成失败' };
const STATUS_CLASS = { pending: 'status-pending', done: 'status-done', failed: 'status-failed' };

async function loadReports() {
    reportsLoading.classList.remove('hidden');
    reportsList.innerHTML = '';
    reportDetail.classList.add('hidden');
    reportsList.classList.remove('hidden');

    try {
        const res = await fetch(`${API_BASE}/api/reports`);
        const result = await res.json();
        if (!result.success) throw new Error(result.error);

        if (result.data.length === 0) {
            reportsList.innerHTML = '<div class="activity-empty">暂无报告，每周一和每月1日自动生成</div>';
            return;
        }

        // 按类型分组
        const grouped = { daily: [], weekly: [], monthly: [] };
        result.data.forEach(r => {
            if (grouped[r.report_type]) grouped[r.report_type].push(r);
        });

        let html = '';
        for (const [type, reports] of Object.entries(grouped)) {
            if (reports.length === 0) continue;
            html += `<div class="report-group"><h2 class="report-group-title">${REPORT_TYPE_LABEL[type] || type}</h2>`;
            html += reports.map(r => createReportCard(r)).join('');
            html += '</div>';
        }
        reportsList.innerHTML = html;

        // 绑定点击
        reportsList.querySelectorAll('.report-card[data-id]').forEach(card => {
            card.addEventListener('click', () => openReport(parseInt(card.dataset.id)));
        });
    } catch (err) {
        reportsList.innerHTML = `<div class="activity-empty">加载失败：${escapeHtml(err.message)}</div>`;
    } finally {
        reportsLoading.classList.add('hidden');
    }
}

function createReportCard(report) {
    const typeLabel = escapeHtml(REPORT_TYPE_LABEL[report.report_type] || report.report_type);
    const start = escapeHtml(String(report.period_start).split('T')[0]);
    const end = escapeHtml(String(report.period_end).split('T')[0]);
    const statusLabel = escapeHtml(STATUS_LABEL[report.status] || report.status);
    const statusClass = STATUS_CLASS[report.status] || '';
    const generatedAt = report.generated_at
        ? new Date(report.generated_at).toLocaleString('zh-CN')
        : '';
    const clickable = report.status === 'done' ? `data-id="${report.id}"` : '';
    const cursor = report.status === 'done' ? 'style="cursor:pointer"' : '';

    return `
        <div class="report-card" ${clickable} ${cursor}>
            <div class="report-card-header">
                <span class="report-type-badge">${typeLabel}</span>
                <span class="report-period">${start} ~ ${end}</span>
                <span class="report-status ${statusClass}">${statusLabel}</span>
            </div>
            ${generatedAt ? `<div class="report-meta">生成于 ${escapeHtml(generatedAt)}</div>` : ''}
        </div>
    `;
}

async function openReport(id) {
    reportsList.classList.add('hidden');
    reportDetail.classList.remove('hidden');
    reportDetailContent.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载中...</p></div>';

    try {
        const res = await fetch(`${API_BASE}/api/reports/${id}`);
        const result = await res.json();
        if (!result.success) throw new Error(result.error);

        const r = result.data;
        const stats = r.stats_json || {};
        const start = String(r.period_start).split('T')[0];
        const end = String(r.period_end).split('T')[0];
        const typeLabel = REPORT_TYPE_LABEL[r.report_type] || r.report_type;

        const isDaily = r.report_type === 'daily';

        const topReposHtml = (stats.top_repos || []).map((repo, i) => {
            const desc = repo.description ? ` data-tooltip="${escapeAttr(repo.description)}"` : '';
            if (isDaily) {
                // Daily: simplified table without appearances/peak-rank columns
                return `
                <tr>
                    <td>${i + 1}</td>
                    <td><a href="https://github.com/${escapeAttr(repo.author)}/${escapeAttr(repo.name)}" target="_blank" rel="noopener" class="repo-link"${desc}>${escapeHtml(repo.author)}/${escapeHtml(repo.name)}</a></td>
                    <td>${escapeHtml(repo.language || '-')}</td>
                    <td>+${Number(repo.avg_period_stars).toLocaleString()}</td>
                </tr>
                `;
            }
            return `
            <tr>
                <td>${i + 1}</td>
                <td><a href="https://github.com/${escapeAttr(repo.author)}/${escapeAttr(repo.name)}" target="_blank" rel="noopener" class="repo-link"${desc}>${escapeHtml(repo.author)}/${escapeHtml(repo.name)}</a></td>
                <td>${escapeHtml(repo.language || '-')}</td>
                <td>${repo.appearances}</td>
                <td>${repo.peak_rank}</td>
                <td>+${repo.avg_period_stars.toLocaleString()}</td>
            </tr>
        `;
        }).join('');

        const langDist = stats.language_distribution || [];
        const langSection = langDist.length > 0
            ? `<div class="report-section">
                <h3>语言分布</h3>
                <div class="lang-bars">${langDist.map(l => {
                    const pct = Math.round(l.pct);
                    return `
                        <div class="lang-bar-row">
                            <span class="lang-name">${escapeHtml(l.language)}</span>
                            <div class="lang-bar-track"><div class="lang-bar-fill" style="width:${Math.min(pct * 2, 100)}%"></div></div>
                            <span class="lang-pct">${l.pct}%</span>
                        </div>
                    `;
                }).join('')}</div>
            </div>`
            : '';

        const mdHtml = r.content_md
            ? (typeof marked !== 'undefined' ? marked.parse(r.content_md) : `<pre>${escapeHtml(r.content_md)}</pre>`)
            : '<p>暂无分析内容</p>';

        reportDetailContent.innerHTML = `
            <div class="report-detail-header">
                <h2>${escapeHtml(typeLabel)}：${escapeHtml(start)} ~ ${escapeHtml(end)}</h2>
                <div class="report-summary-stats">
                    <span>上榜次数 <strong>${stats.total_appearances || 0}</strong></span>
                    <span>独立项目 <strong>${stats.unique_repos || 0}</strong></span>
                </div>
            </div>

            <div class="report-section">
                <h3>${isDaily ? '当日项目' : 'Top 项目'}</h3>
                <div class="report-table-wrap">
                    <table class="report-table">
                        <thead><tr>
                            <th>#</th><th>项目</th><th>语言</th>
                            ${isDaily ? '<th>本日新增 Stars</th>' : '<th>上榜次数</th><th>最高排名</th><th>平均新增 Stars</th>'}
                        </tr></thead>
                        <tbody>${topReposHtml}</tbody>
                    </table>
                </div>
            </div>

            ${langSection}

            <div class="report-section report-markdown">
                <h3>AI 分析</h3>
                <div class="markdown-body">${mdHtml}</div>
            </div>
        `;
    } catch (err) {
        reportDetailContent.innerHTML = `<div class="activity-empty">加载失败：${escapeHtml(err.message)}</div>`;
    }
}

function showReportList() {
    reportDetail.classList.add('hidden');
    reportsList.classList.remove('hidden');
}

// ─── AI 设置 ────────────────────────────────────────────────────────────────

const FEATURE_LABELS = { translate: '翻译', report: '报告', recommendation: '推荐', web_search: '联网搜索' };
const STATUS_TEXTS = { connected: '已连接', error: '连接失败', untested: '待测试', unconfigured: '未配置' };

async function loadProviders() {
    const container = document.getElementById('providers-list');
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载中...</p></div>';

    try {
        const [providersRes, assignRes] = await Promise.all([
            fetch(`${API_BASE}/api/ai-providers`).then(r => r.json()),
            fetch(`${API_BASE}/api/ai-providers/task-assign`).then(r => r.json()),
        ]);
        if (!providersRes.success) throw new Error(providersRes.error);

        const providers = providersRes.data;
        const assign = assignRes.success ? assignRes.data : {};

        // 填充任务分配下拉框
        const configuredProviders = providers.filter(p => p.configured);
        ['translate', 'report', 'recommendation'].forEach(task => {
            const sel = document.getElementById(`assign-${task}`);
            if (!sel) return;
            const current = sel.value;
            sel.innerHTML = '<option value="">自动选择</option>' +
                configuredProviders.map(p =>
                    `<option value="${escapeAttr(p.id)}"${assign[task] === p.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
                ).join('');
            if (!assign[task]) sel.value = '';
        });

        container.innerHTML = providers.map(p => createProviderCard(p)).join('');
        bindProviderEvents();
    } catch (err) {
        container.innerHTML = `<div class="activity-empty">加载失败：${escapeHtml(err.message)}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('saveTaskAssign')?.addEventListener('click', async () => {
        const btn = document.getElementById('saveTaskAssign');
        const resultEl = document.getElementById('task-assign-result');
        btn.disabled = true;
        try {
            const assign = {
                translate: document.getElementById('assign-translate').value || null,
                report: document.getElementById('assign-report').value || null,
                recommendation: document.getElementById('assign-recommendation').value || null,
            };
            const res = await fetch(`${API_BASE}/api/ai-providers/task-assign`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(assign),
            });
            const result = await res.json();
            if (result.success) {
                showTestResult(resultEl, 'success',
                    `已保存 · 翻译: ${assign.translate || '自动'} · 报告: ${assign.report || '自动'} · 推荐: ${assign.recommendation || '自动'}`);
            } else {
                showTestResult(resultEl, 'error', result.error);
            }
        } catch (err) {
            showTestResult(resultEl, 'error', err.message);
        } finally {
            btn.disabled = false;
        }
    });
});

function createProviderCard(provider) {
    const features = provider.features.filter(f => f !== 'web_search').map(f => {
        const active = provider.configured ? ' active' : '';
        return `<span class="feature-tag${active}">${escapeHtml(FEATURE_LABELS[f] || f)}</span>`;
    }).join('');

    const webSearchTag = provider.features.includes('web_search')
        ? `<span class="feature-tag${provider.configured ? ' web-search' : ''}">${FEATURE_LABELS.web_search}</span>` : '';

    const statusText = STATUS_TEXTS[provider.status] || provider.status;
    const statusDot = provider.status === 'connected' ? 'connected'
        : provider.status === 'error' ? 'error'
        : provider.status === 'untested' ? 'untested' : 'unconfigured';

    const latencyInfo = provider.lastTested && provider.status === 'connected'
        ? `<span class="provider-latency">${new Date(provider.lastTested).toLocaleString('zh-CN')}</span>` : '';
    const keyPlaceholder = provider.hasApiKey ? '已配置 (••••)，留空则保留' : '输入 API Key...';

    // 模型选择区域（仅已配置的供应商显示）
    const models = provider.selectedModels || provider.defaultModels;
    const cached = provider.cachedModels;
    const modelSection = provider.configured ? `
        <div class="model-selection">
            <div class="model-row">
                <label>翻译模型</label>
                <div class="model-select-wrap">
                    <select data-model-select="${escapeAttr(provider.id)}" data-role="translate">
                        ${buildModelOptions(cached, models.translate || provider.defaultModels.translate, provider.defaultModels.translate)}
                    </select>
                </div>
            </div>
            <div class="model-row">
                <label>报告模型</label>
                <div class="model-select-wrap">
                    <select data-model-select="${escapeAttr(provider.id)}" data-role="report">
                        ${buildModelOptions(cached, models.report || provider.defaultModels.report, provider.defaultModels.report)}
                    </select>
                </div>
            </div>
            <div class="model-row">
                <label>推荐模型</label>
                <div class="model-select-wrap">
                    <select data-model-select="${escapeAttr(provider.id)}" data-role="recommendation">
                        ${buildModelOptions(cached, models.recommendation || provider.defaultModels.recommendation, provider.defaultModels.recommendation)}
                    </select>
                </div>
            </div>
            <div class="model-actions">
                <button class="btn-sm btn-fetch-models" data-action="fetch-models" data-id="${escapeAttr(provider.id)}">刷新模型列表</button>
                <button class="btn-sm btn-save-models" data-action="save-models" data-id="${escapeAttr(provider.id)}">保存模型选择</button>
            </div>
        </div>
    ` : '';

    return `
        <div class="provider-card" data-provider-id="${escapeAttr(provider.id)}" data-has-key="${provider.hasApiKey ? 'true' : ''}">
            <div class="provider-card-header">
                <span class="provider-name">${escapeHtml(provider.name)}</span>
                <span class="provider-status">
                    <span class="status-dot ${statusDot}"></span>
                    ${escapeHtml(statusText)}${latencyInfo}
                </span>
                <div class="provider-features">${features}${webSearchTag}</div>
            </div>
            <div class="provider-form">
                <div class="key-input-wrap">
                    <input type="password" placeholder="${escapeAttr(keyPlaceholder)}" data-key-input="${escapeAttr(provider.id)}" value="" autocomplete="off">
                    <button class="btn-toggle-key" data-action="toggle-key" data-id="${escapeAttr(provider.id)}" title="显示/隐藏">👁</button>
                </div>
                <button class="btn-sm btn-test" data-action="test" data-id="${escapeAttr(provider.id)}">测试连通</button>
                <button class="btn-sm btn-save" data-action="save" data-id="${escapeAttr(provider.id)}">保存</button>
                ${provider.configured ? `<button class="btn-sm btn-remove" data-action="remove" data-id="${escapeAttr(provider.id)}">删除</button>` : ''}
            </div>
            <div class="provider-test-result" data-result="${escapeAttr(provider.id)}"></div>
            ${modelSection}
        </div>
    `;
}

function buildModelOptions(cachedModels, selectedId, defaultId) {
    if (!cachedModels || cachedModels.length === 0) {
        // 没有缓存的模型列表，只显示当前选中的（可编辑）
        return `<option value="${escapeAttr(selectedId)}" selected>${escapeHtml(selectedId)}</option>`;
    }
    let opts = cachedModels.map(m => {
        const sel = m.id === selectedId ? ' selected' : '';
        const label = m.id === defaultId ? `${m.id} (默认)` : m.id;
        return `<option value="${escapeAttr(m.id)}"${sel}>${escapeHtml(label)}</option>`;
    }).join('');
    // 如果选中的不在列表中，加到前面
    if (selectedId && !cachedModels.find(m => m.id === selectedId)) {
        opts = `<option value="${escapeAttr(selectedId)}" selected>${escapeHtml(selectedId)} (自定义)</option>` + opts;
    }
    return opts;
}

function bindProviderEvents() {
    document.querySelectorAll('.provider-card .btn-sm').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            const card = btn.closest('.provider-card');
            const input = card.querySelector(`[data-key-input="${id}"]`);
            const resultEl = card.querySelector(`[data-result="${id}"]`);

            if (action === 'toggle-key') {
                const inp = card.querySelector(`[data-key-input="${id}"]`);
                inp.type = inp.type === 'password' ? 'text' : 'password';
                return;
            }

            if (action === 'test') {
                const apiKey = input.value.trim();
                if (!apiKey && !card.dataset.hasKey) { showTestResult(resultEl, 'error', '请输入 API Key'); return; }
                btn.disabled = true;
                btn.textContent = '测试中...';
                showTestResult(resultEl, 'testing', '正在连接...');
                try {
                    const res = await fetch(`${API_BASE}/api/ai-providers/test`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id, apiKey: apiKey || undefined })
                    });
                    const result = await res.json();
                    if (result.success && result.data.success) {
                        showTestResult(resultEl, 'success',
                            `连接成功 · 模型: ${result.data.model} · 延迟: ${result.data.latency}ms · 回复: "${result.data.reply}"`);
                    } else {
                        showTestResult(resultEl, 'error', `连接失败: ${result.data?.error || result.error}`);
                    }
                } catch (err) {
                    showTestResult(resultEl, 'error', `请求失败: ${err.message}`);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '测试连通';
                }
            }

            if (action === 'save') {
                const apiKey = input.value.trim();
                if (!apiKey && !card.dataset.hasKey) { showTestResult(resultEl, 'error', '请输入 API Key'); return; }
                btn.disabled = true;
                try {
                    // 先保存 key
                    const res = await fetch(`${API_BASE}/api/ai-providers`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id, apiKey })
                    });
                    const result = await res.json();
                    if (result.success) {
                        // 自动测试连通
                        showTestResult(resultEl, 'testing', '已保存，正在测试连通...');
                        const testRes = await fetch(`${API_BASE}/api/ai-providers/test`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id, apiKey: apiKey || undefined })
                        });
                        const testResult = await testRes.json();
                        if (testResult.success && testResult.data.success) {
                            showTestResult(resultEl, 'success', `已保存并连接成功 · 延迟: ${testResult.data.latency}ms`);
                            // 自动拉取模型列表
                            fetch(`${API_BASE}/api/ai-providers/models`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id, apiKey: apiKey || undefined })
                            }).finally(() => setTimeout(() => loadProviders(), 600));
                        } else {
                            showTestResult(resultEl, 'error', `已保存但连接失败: ${testResult.data?.error || ''}`);
                            setTimeout(() => loadProviders(), 800);
                        }
                    } else {
                        showTestResult(resultEl, 'error', result.error);
                    }
                } catch (err) {
                    showTestResult(resultEl, 'error', err.message);
                } finally {
                    btn.disabled = false;
                }
            }

            if (action === 'remove') {
                if (!confirm('确定要删除此供应商配置？')) return;
                try {
                    await fetch(`${API_BASE}/api/ai-providers/${id}`, { method: 'DELETE' });
                    loadProviders();
                } catch (err) {
                    showTestResult(resultEl, 'error', err.message);
                }
            }

            if (action === 'fetch-models') {
                btn.disabled = true;
                btn.textContent = '拉取中...';
                try {
                    const apiKey = input?.value.trim() || undefined;
                    const res = await fetch(`${API_BASE}/api/ai-providers/models`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id, apiKey })
                    });
                    const result = await res.json();
                    if (result.success) {
                        // 更新下拉列表
                        card.querySelectorAll(`[data-model-select="${id}"]`).forEach(sel => {
                            const role = sel.dataset.role;
                            const currentVal = sel.value;
                            const preset = result.data;
                            sel.innerHTML = buildModelOptions(preset, currentVal, currentVal);
                        });
                        showTestResult(resultEl, 'success', `获取到 ${result.data.length} 个模型`);
                        setTimeout(() => loadProviders(), 500);
                    } else {
                        showTestResult(resultEl, 'error', result.error);
                    }
                } catch (err) {
                    showTestResult(resultEl, 'error', err.message);
                } finally {
                    btn.disabled = false;
                    btn.textContent = '刷新模型列表';
                }
            }

            if (action === 'save-models') {
                const translateSel = card.querySelector(`[data-model-select="${id}"][data-role="translate"]`);
                const reportSel = card.querySelector(`[data-model-select="${id}"][data-role="report"]`);
                const recommendationSel = card.querySelector(`[data-model-select="${id}"][data-role="recommendation"]`);
                const selectedModels = {
                    translate: translateSel.value,
                    report: reportSel.value,
                    recommendation: recommendationSel.value
                };
                btn.disabled = true;
                try {
                    const res = await fetch(`${API_BASE}/api/ai-providers/${id}/models`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ selectedModels })
                    });
                    const result = await res.json();
                    if (result.success) {
                        showTestResult(resultEl, 'success', `模型已保存 · 翻译: ${selectedModels.translate} · 报告: ${selectedModels.report} · 推荐: ${selectedModels.recommendation}`);
                    } else {
                        showTestResult(resultEl, 'error', result.error);
                    }
                } catch (err) {
                    showTestResult(resultEl, 'error', err.message);
                } finally {
                    btn.disabled = false;
                }
            }
        });
    });
}

function showTestResult(el, type, message) {
    el.className = `provider-test-result ${type}`;
    el.textContent = message;
}

// ─── Repo link tooltip ───────────────────────────────────────────────────────

const tooltip = document.createElement('div');
tooltip.id = 'repo-tooltip';
document.body.appendChild(tooltip);

document.addEventListener('mouseover', e => {
    const link = e.target.closest('.repo-link[data-tooltip]');
    if (!link) return;
    tooltip.textContent = link.dataset.tooltip;
    tooltip.style.opacity = '0';
    tooltip.style.display = 'block';

    const rect = link.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const margin = 8;

    // 默认在元素上方居中
    let left = rect.left + rect.width / 2 - tw / 2;
    let top = rect.top - th - margin;

    // 右侧溢出修正
    if (left + tw > window.innerWidth - margin) left = window.innerWidth - tw - margin;
    // 左侧溢出修正
    if (left < margin) left = margin;
    // 上方空间不够时改为下方
    if (top < margin) top = rect.bottom + margin;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.style.opacity = '1';
});

document.addEventListener('mouseout', e => {
    if (e.target.closest('.repo-link[data-tooltip]')) tooltip.style.opacity = '0';
});
