/**
 * AI Provider 管理模块
 * 支持多个 AI API 供应商的配置、模型选择、连通测试和调用
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const secretVault = require('./src/crypto/secret-vault');
const { withRetry } = require('./src/lib/ai-retry');

const CONFIG_FILE = process.env.AI_PROVIDERS_FILE || path.join(__dirname, 'data', 'ai-providers.json');
const TASK_FILE = process.env.AI_TASK_ASSIGN_FILE || path.join(__dirname, 'data', 'ai-task-assign.json');

// 任务分配缓存：{ translate: 'deepseek', report: 'glm', recommendation: 'deepseek' }
let taskAssign = null;

// 预设供应商定义
const PROVIDER_PRESETS = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModels: { translate: 'deepseek-v4-flash', report: 'deepseek-v4-pro', recommendation: 'deepseek-v4-flash' },
    features: ['translate', 'report', 'recommendation'],
    webSearchModels: [],
  },
  glm: {
    id: 'glm',
    name: 'GLM (智谱AI)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModels: { translate: 'glm-4-flash', report: 'glm-5', recommendation: 'glm-5' },
    features: ['translate', 'report', 'recommendation', 'web_search'],
    webSearchModels: ['glm-4-plus', 'glm-5', 'glm-5.1'],
  },
  'glm-coding': {
    id: 'glm-coding',
    name: 'GLM Coding Plan (智谱)',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModels: { translate: 'glm-4-flash', report: 'glm-5', recommendation: 'glm-5' },
    features: ['translate', 'report', 'recommendation'],
    webSearchModels: [],
  },
  'minimax-coding': {
    id: 'minimax-coding',
    name: 'MiniMax Coding Plan',
    baseUrl: 'https://api.minimaxi.com/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModels: { translate: 'MiniMax-M2.5', report: 'MiniMax-M2.5', recommendation: 'MiniMax-M2.5' },
    features: ['translate', 'report', 'recommendation'],
    webSearchModels: [],
  },
  siliconflow: {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.com/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModels: { translate: 'THUDM/GLM-4-9B-0414', report: 'deepseek-ai/DeepSeek-V3', recommendation: 'deepseek-ai/DeepSeek-V3' },
    features: ['translate', 'report', 'recommendation'],
    webSearchModels: [],
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModels: { translate: 'google/gemini-2.5-flash', report: 'google/gemini-2.5-flash', recommendation: 'google/gemini-2.5-flash' },
    features: ['translate', 'report', 'recommendation'],
    webSearchModels: [],
  },
};

// 已配置的供应商列表（运行时缓存）
let configuredProviders = null;

async function ensureDataDir() {
  const dir = path.dirname(CONFIG_FILE);
  try { await fs.access(dir); } catch { await fs.mkdir(dir, { recursive: true }); }
}

async function loadProviders() {
  if (configuredProviders) return configuredProviders;
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    configuredProviders = JSON.parse(data).map(provider => ({
      ...provider,
      apiKey: decryptProviderKey(provider.apiKey)
    }));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    configuredProviders = [];
  }
  return configuredProviders;
}

async function saveProviders() {
  await ensureDataDir();
  const providersForDisk = (configuredProviders || []).map(provider => ({
    ...provider,
    apiKey: encryptProviderKey(provider.apiKey)
  }));
  await fs.writeFile(CONFIG_FILE, JSON.stringify(providersForDisk, null, 2));
}

async function loadTaskAssign() {
  if (taskAssign) return taskAssign;
  try {
    const db = require('./db');
    const val = await db.getSetting('ai-task-assign');
    if (val) { taskAssign = val; return taskAssign; }
  } catch { /* DB unavailable, fall through */ }
  try {
    const data = await fs.readFile(TASK_FILE, 'utf8');
    taskAssign = JSON.parse(data);
  } catch {
    taskAssign = {};
  }
  return taskAssign;
}

async function saveTaskAssign() {
  try {
    const db = require('./db');
    await db.setSetting('ai-task-assign', taskAssign);
  } catch { /* DB unavailable, fall through */ }
  try {
    await ensureDataDir();
    await fs.writeFile(TASK_FILE, JSON.stringify(taskAssign, null, 2));
  } catch { /* best-effort */ }
}

async function getTaskAssign() {
  return loadTaskAssign();
}

async function updateTaskAssign(assign) {
  taskAssign = { ...await loadTaskAssign(), ...assign };
  await saveTaskAssign();
  return taskAssign;
}

// 获取所有预设供应商（含已配置状态和用户选择的模型）
async function getPresets() {
  const providers = await loadProviders();
  return Object.values(PROVIDER_PRESETS).map(preset => {
    const configured = providers.find(p => p.id === preset.id);
    return {
      ...preset,
      configured: !!configured,
      status: configured ? configured.status : 'unconfigured',
      lastTested: configured ? configured.lastTested : null,
      selectedModels: configured?.selectedModels || preset.defaultModels,
      cachedModels: configured?.cachedModels || null,
      hasApiKey: !!configured?.apiKey,
      apiKey: '',
    };
  });
}

// 添加/更新供应商配置
async function upsertProvider(id, apiKey) {
  const preset = PROVIDER_PRESETS[id];
  if (!preset) throw new Error(`Unknown provider: ${id}`);

  const providers = await loadProviders();
  const existing = providers.find(p => p.id === id);

  if (existing) {
    if (apiKey) {
      existing.apiKey = apiKey;
      existing.status = 'untested';
      existing.lastTested = null;
    }
  } else {
    if (!apiKey) throw new Error('API key not provided');
    providers.push({
      id,
      apiKey,
      status: 'untested',
      lastTested: null,
      selectedModels: { ...preset.defaultModels },
      cachedModels: null,
    });
  }

  await saveProviders();
  return { id, status: 'untested' };
}

function decryptProviderKey(apiKey) {
  if (!apiKey) return apiKey;
  return secretVault.decrypt(apiKey);
}

function encryptProviderKey(apiKey) {
  if (!apiKey || secretVault.isEncrypted(apiKey)) return apiKey;
  if (!secretVault.canEncrypt()) return apiKey;
  return secretVault.encrypt(apiKey);
}

// 更新供应商的模型选择
async function updateModels(id, selectedModels) {
  const providers = await loadProviders();
  const p = providers.find(p => p.id === id);
  if (!p) throw new Error(`Provider not configured: ${id}`);
  p.selectedModels = { ...p.selectedModels, ...selectedModels };
  await saveProviders();
  return p.selectedModels;
}

// 删除供应商配置
async function removeProvider(id) {
  const providers = await loadProviders();
  const idx = providers.findIndex(p => p.id === id);
  if (idx === -1) throw new Error(`Provider not configured: ${id}`);
  providers.splice(idx, 1);
  await saveProviders();
}

// 从 API 拉取可用模型列表
async function fetchModels(id, apiKey) {
  const preset = PROVIDER_PRESETS[id];
  if (!preset) throw new Error(`Unknown provider: ${id}`);

  const providers = await loadProviders();
  const p = providers.find(p => p.id === id);
  const key = apiKey || p?.apiKey;
  if (!key) throw new Error('API key not provided');

  try {
    const res = await axios.get(`${preset.baseUrl}${preset.modelsPath}`, {
      headers: { 'Authorization': `Bearer ${key}` },
      timeout: 15000,
    });

    const models = (res.data.data || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      owned_by: m.owned_by || '',
    }));

    // 按 id 排序
    models.sort((a, b) => a.id.localeCompare(b.id));

    // 缓存模型列表
    if (p) {
      p.cachedModels = models;
      await saveProviders();
    }

    return models;
  } catch (err) {
    throw new Error(`Failed to fetch models: ${err.response?.data?.error?.message || err.message}`);
  }
}

// 测试供应商连通性（用用户选择的模型或默认模型）
async function testProvider(id, apiKey, testModel) {
  const preset = PROVIDER_PRESETS[id];
  if (!preset) throw new Error(`Unknown provider: ${id}`);

  const providers = await loadProviders();
  const p = providers.find(p => p.id === id);
  const key = apiKey || p?.apiKey;
  if (!key) throw new Error('API key not provided');

  const model = testModel || p?.selectedModels?.translate || preset.defaultModels.translate;
  const url = `${preset.baseUrl}${preset.chatPath}`;
  const startTime = Date.now();

  try {
    const response = await axios.post(url, {
      model,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 10,
    }, {
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    const latency = Date.now() - startTime;
    const content = response.data.choices?.[0]?.message?.content || '';

    if (p) {
      p.status = 'connected';
      p.lastTested = new Date().toISOString();
      p.latency = latency;
      await saveProviders();
    }

    return { success: true, latency, model, reply: content.substring(0, 50), usage: response.data.usage || {} };
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    if (p) {
      p.status = 'error';
      p.lastTested = new Date().toISOString();
      p.errorMessage = errMsg;
      await saveProviders();
    }
    return { success: false, error: errMsg, latency: Date.now() - startTime };
  }
}

// 获取某个功能对应的 provider + 模型
async function getProviderForFeature(feature) {
  const providers = await loadProviders();
  const assign = await loadTaskAssign();
  const assignedId = assign[feature];

  // 找到一个满足条件的 provider
  function pick(list) {
    for (const p of list) {
      const preset = PROVIDER_PRESETS[p.id];
      if (!preset || !preset.features.includes(feature) || !p.apiKey) continue;
      const modelId = p.selectedModels?.[feature] || preset.defaultModels[feature];
      const webSearch = preset.webSearchModels.includes(modelId);
      return { preset, apiKey: p.apiKey, model: modelId, webSearch };
    }
    return null;
  }

  // 1. 优先用户指定的供应商（已连接）
  if (assignedId) {
    const assigned = providers.filter(p => p.id === assignedId && p.status === 'connected');
    const result = pick(assigned);
    if (result) return result;
  }

  // 2. 任何已连接的
  const connected = providers.filter(p => p.status === 'connected');
  const result = pick(connected);
  if (result) return result;

  // 3. 降级：任何有 key 的（含未测试）
  return pick(providers);
}

// 调用 AI 进行翻译（单条）
// 成功返回译文，失败抛出异常（由调用方决定降级策略）
async function translate(text) {
  const provider = await getProviderForFeature('translate');
  if (!provider) throw new Error('No AI provider configured for translation');

  const { preset, apiKey, model } = provider;
  const response = await withRetry(
    () => axios.post(
      `${preset.baseUrl}${preset.chatPath}`,
      {
        model,
        max_tokens: 300,
        messages: [{ role: 'user', content: `请将以下英文翻译成中文，只需返回翻译结果，不要任何解释：\n\n${text}` }],
      },
      { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    ),
    { label: 'Translate' }
  );
  const content = response.data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty translation response');
  return content;
}

// 批量翻译
async function translateBatch(texts) {
  const provider = await getProviderForFeature('translate');
  if (!provider || texts.length === 0) return texts;

  const { preset, apiKey, model } = provider;
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');

  try {
    const response = await withRetry(
      () => axios.post(
        `${preset.baseUrl}${preset.chatPath}`,
        {
          model,
          max_tokens: 800,
          messages: [{ role: 'user', content: `将以下英文按原编号翻译成中文，只返回"编号. 译文"格式，不要任何解释：\n${numbered}` }],
        },
        { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
      ),
      { label: 'TranslateBatch' }
    );
    const raw = (response.data.choices?.[0]?.message?.content || '').trim();
    const result = [...texts];
    raw.split('\n').forEach(line => {
      const m = line.match(/^(\d+)\.\s+(.+)/);
      if (m) {
        const idx = parseInt(m[1]) - 1;
        if (idx >= 0 && idx < result.length) result[idx] = m[2].trim();
      }
    });
    return result;
  } catch (err) {
    console.warn('Batch translation failed:', err.message);
    return texts;
  }
}

// 生成报告（周报/月报，支持联网搜索）
async function generateReport(stats, reportType) {
  const provider = await getProviderForFeature('report');
  if (!provider) throw new Error('No AI provider configured for report generation');

  const { preset, apiKey, model, webSearch } = provider;
  const isWeekly = reportType === 'weekly';
  const label = isWeekly ? '周' : '月';
  const maxTokens = isWeekly ? 6000 : 10000;

  // Build daily appearance data if available
  const dailyBreakdown = (stats.daily_counts && stats.daily_counts.length > 0)
    ? `\n每日上榜数量变化：\n${stats.daily_counts.map(d => `  ${d.date}: 日榜${d.daily}个 周榜${d.weekly}个 月榜${d.monthly}个`).join('\n')}`
    : '';

  const statsText = [
    `时间范围：${stats.period_start} 至 ${stats.period_end}`,
    `总上榜次数：${stats.total_appearances}，独立项目数：${stats.unique_repos}`,
    dailyBreakdown,
    '',
    'Top 15 最活跃项目（含 AI 摘要）：',
    ...stats.top_repos.map((r, i) => {
      let line = `${i + 1}. ${r.author}/${r.name}（${r.language || '未知'}）`;
      line += `\n   上榜 ${r.appearances} 次，最高排名第 ${r.peak_rank}，首次上榜 ${r.first_seen || '—'}，最近上榜 ${r.last_seen || '—'}，日均新增 ${r.avg_period_stars} stars`;
      if (r.ai_summary) {
        line += `\n   AI 摘要：${r.ai_summary}`;
      } else if (r.description) {
        line += `\n   简介：${r.description}`;
      }
      return line;
    }),
    '',
    '编程语言分布（Top 10）：',
    ...stats.language_distribution.slice(0, 10).map(l =>
      `- ${l.language}: ${l.count} 次 (${l.pct}%)`
    )
  ].join('\n');

  // Different prompts for weekly vs monthly
  const role = `你是一位资深开源技术趋势分析师，擅长从 GitHub 数据中识别技术范式的迁移。`;
  const requirements = isWeekly
    ? `请撰写一份 ${label}度趋势周评（Markdown），结构如下：

## 📊 核心信号（3-5条）
每条一个核心判断 + 数据支撑。不是复述数据，是说出数据背后的含义。
示例："Agent 编排从实验走向工程化 —— 本周 3 个编排框架同时上榜，且排名持续攀升，说明社区正在寻找比 LangChain 更轻量的替代方案。"

## 🔍 升温方向
哪些领域在本周明显加速（频次增加、新项目闯入、语言分布变化）？各用一段话分析，含具体项目佐证。

## 📉 降温信号
哪些主题在退潮或增速放缓？客观描述，不说套话。

## 🏗 值得关注的新面孔
本周首次上榜的项目中，挑 2-3 个分析其潜力和限制。

## 🔮 下周看点
基于当前趋势，预测下周可能的方向。要求具体（指出某个项目、某个事件、某个技术方向），不空泛。
`
    : `请撰写一份 ${label}度战略趋势综述（Markdown），结构如下：

## 📊 本月格局（5-8条核心判断）
从全局视角总结本月的技术生态变化。每条判断必须有数据或项目案例支撑。涵盖：什么方向在崛起、什么在成熟、什么在退潮、什么出乎意料。

## 🔬 深度专题：<自选一个本月最值得展开的主题>
选本月最核心的一条主线做 300-400 字的专题分析。示例主题："Agent 编排框架的战国时代""Rust 正在吞噬 AI 工具链""开源替代品的商业化临界点"。要求有观点、有对比、有判断。

## 🏆 本月之星（3-5个）
最具影响力的项目，每个用一段话分析：
- 为什么它重要（不只是数据好，要讲清楚它在技术生态中的位置）
- 局限和风险（保持批判性，不要只夸）
- 下一步看什么

## 🌐 语言与生态
结合语言分布数据，分析不同技术栈的活跃度变化趋势，解释变化背后的可能原因。

## 🔮 未来三个月
超越数据本身，给出 2-3 个未来三个月可能出现的技术趋势前瞻。要求有逻辑推演，不只是猜测。
`;

  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: webSearch
        ? `${role}\n以下是 GitHub Trending ${label}报告数据（${stats.period_start} ~ ${stats.period_end}）：\n\n${statsText}\n\n请先搜索了解关键项目的近期动态（版本发布、公司新闻、社区事件），然后按以下要求撰写报告。禁止输出"根据数据""我们分析""从统计来看"等前缀句，直接写内容。\n\n${requirements}`
        : `${role}\n以下是 GitHub Trending ${label}报告数据（${stats.period_start} ~ ${stats.period_end}）：\n\n${statsText}\n\n请按以下要求撰写报告。禁止输出"根据数据""我们分析""从统计来看"等前缀句，直接写内容。\n\n${requirements}`
    }],
  };

  if (webSearch) {
    body.tools = [{ type: 'web_search', web_search: { enable: true, search_result: true } }];
  }

  const response = await withRetry(
    () => axios.post(
      `${preset.baseUrl}${preset.chatPath}`,
      body,
      { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 300000 }
    ),
    { label: `Report ${reportType}` }
  );

  const aiContent = (response.data.choices?.[0]?.message?.content || '').trim();

  // 标题 + 确定性「数据速览」(语言分布表，免 AI)
  const langs = (stats.language_distribution || []).slice(0, 8);
  const langTable = langs.length
    ? `### 语言分布\n\n| 语言 | 占比 | 上榜次数 |\n| --- | --- | --- |\n${langs.map(l => `| ${l.language} | ${l.pct}% | ${l.count} |`).join('\n')}\n\n`
    : '';
  const digest = `# 📈 GitHub 趋势${label}报 · ${stats.period_start} ~ ${stats.period_end}\n\n`
    + `## 📊 数据速览\n\n总上榜 ${stats.total_appearances} 次 · 独立项目 ${stats.unique_repos} 个\n\n${langTable}---\n\n`;

  return digest + aiContent;
}

module.exports = {
  PROVIDER_PRESETS,
  getPresets,
  getTaskAssign,
  updateTaskAssign,
  upsertProvider,
  updateModels,
  removeProvider,
  fetchModels,
  testProvider,
  translate,
  translateBatch,
  generateReport,
  getProviderForFeature,
};
