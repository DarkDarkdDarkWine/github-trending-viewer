/**
 * AI Provider 管理模块
 * 支持多个 AI API 供应商的配置、连通测试和调用
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'data', 'ai-providers.json');

// 预设供应商定义
const PROVIDER_PRESETS = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    chatPath: '/chat/completions',
    testModel: 'deepseek-chat',
    models: {
      translate: 'deepseek-chat',
      report: 'deepseek-chat',
    },
    features: ['translate', 'report'],
    webSearch: false,
  },
  glm: {
    id: 'glm',
    name: 'GLM (智谱AI)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    chatPath: '/chat/completions',
    testModel: 'glm-4-flash',
    models: {
      translate: 'glm-4-flash',
      report: 'glm-5',
    },
    features: ['translate', 'report', 'web_search'],
    webSearch: true,
  },
  'glm-coding': {
    id: 'glm-coding',
    name: 'GLM Coding Plan (智谱)',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    chatPath: '/chat/completions',
    testModel: 'glm-4-flash',
    models: {
      translate: 'glm-4-flash',
      report: 'glm-5',
    },
    features: ['translate', 'report'],
    webSearch: false,
  },
  'minimax-coding': {
    id: 'minimax-coding',
    name: 'MiniMax Coding Plan',
    baseUrl: 'https://api.minimaxi.com/v1',
    chatPath: '/chat/completions',
    testModel: 'MiniMax-M2.5',
    models: {
      translate: 'MiniMax-M2.5',
      report: 'MiniMax-M2.5',
    },
    features: ['translate', 'report'],
    webSearch: false,
  },
  siliconflow: {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.com/v1',
    chatPath: '/chat/completions',
    testModel: 'THUDM/GLM-4-9B-0414',
    models: {
      translate: 'THUDM/GLM-4-9B-0414',
      report: 'deepseek-ai/DeepSeek-V3',
    },
    features: ['translate', 'report'],
    webSearch: false,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    testModel: 'google/gemini-2.5-flash',
    models: {
      translate: 'google/gemini-2.5-flash',
      report: 'google/gemini-2.5-flash',
    },
    features: ['translate', 'report'],
    webSearch: false,
  },
};

// 已配置的供应商列表（运行时缓存）
let configuredProviders = null;

async function ensureDataDir() {
  const dir = path.dirname(CONFIG_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function loadProviders() {
  if (configuredProviders) return configuredProviders;
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    configuredProviders = JSON.parse(data);
  } catch {
    configuredProviders = [];
  }
  return configuredProviders;
}

async function saveProviders() {
  await ensureDataDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(configuredProviders, null, 2));
}

// 获取所有预设供应商（含已配置状态）
async function getPresets() {
  const providers = await loadProviders();
  return Object.values(PROVIDER_PRESETS).map(preset => {
    const configured = providers.find(p => p.id === preset.id);
    return {
      ...preset,
      configured: !!configured,
      status: configured ? configured.status : 'unconfigured',
      lastTested: configured ? configured.lastTested : null,
    };
  });
}

// 获取已配置的供应商
async function getConfigured() {
  return loadProviders();
}

// 添加/更新供应商配置
async function upsertProvider(id, apiKey) {
  const preset = PROVIDER_PRESETS[id];
  if (!preset) throw new Error(`Unknown provider: ${id}`);

  const providers = await loadProviders();
  const existing = providers.find(p => p.id === id);

  if (existing) {
    existing.apiKey = apiKey;
    existing.status = 'untested';
    existing.lastTested = null;
  } else {
    providers.push({
      id,
      apiKey,
      status: 'untested',
      lastTested: null,
    });
  }

  await saveProviders();
  return { id, status: 'untested' };
}

// 删除供应商配置
async function removeProvider(id) {
  const providers = await loadProviders();
  const idx = providers.findIndex(p => p.id === id);
  if (idx === -1) throw new Error(`Provider not configured: ${id}`);
  providers.splice(idx, 1);
  await saveProviders();
}

// 测试供应商连通性
async function testProvider(id, apiKey) {
  const preset = PROVIDER_PRESETS[id];
  if (!preset) throw new Error(`Unknown provider: ${id}`);

  const key = apiKey || (await loadProviders()).find(p => p.id === id)?.apiKey;
  if (!key) throw new Error('API key not provided');

  const url = `${preset.baseUrl}${preset.chatPath}`;
  const startTime = Date.now();

  try {
    const response = await axios.post(url, {
      model: preset.testModel,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 10,
    }, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const latency = Date.now() - startTime;
    const content = response.data.choices?.[0]?.message?.content || '';
    const usage = response.data.usage || {};

    // 更新状态
    const providers = await loadProviders();
    const p = providers.find(p => p.id === id);
    if (p) {
      p.status = 'connected';
      p.lastTested = new Date().toISOString();
      p.latency = latency;
      await saveProviders();
    }

    return {
      success: true,
      latency,
      model: preset.testModel,
      reply: content.substring(0, 50),
      usage,
    };
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;

    const providers = await loadProviders();
    const p = providers.find(p => p.id === id);
    if (p) {
      p.status = 'error';
      p.lastTested = new Date().toISOString();
      p.errorMessage = errMsg;
      await saveProviders();
    }

    return {
      success: false,
      error: errMsg,
      latency: Date.now() - startTime,
    };
  }
}

// 调用 AI 进行翻译（单条）
async function translate(text) {
  const provider = await getProviderForFeature('translate');
  if (!provider) return text;

  const { preset, apiKey } = provider;
  try {
    const response = await axios.post(
      `${preset.baseUrl}${preset.chatPath}`,
      {
        model: preset.models.translate,
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `请将以下英文翻译成中文，只需返回翻译结果，不要任何解释：\n\n${text}`
        }],
      },
      {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    return response.data.choices?.[0]?.message?.content?.trim() || text;
  } catch (err) {
    console.warn('AI translation failed:', err.response?.data?.error?.message || err.message);
    return text;
  }
}

// 批量翻译
async function translateBatch(texts) {
  const provider = await getProviderForFeature('translate');
  if (!provider || texts.length === 0) return texts;

  const { preset, apiKey } = provider;
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');

  try {
    const response = await axios.post(
      `${preset.baseUrl}${preset.chatPath}`,
      {
        model: preset.models.translate,
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `将以下英文按原编号翻译成中文，只返回"编号. 译文"格式，不要任何解释：\n${numbered}`
        }],
      },
      {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    const raw = response.data.choices[0].message.content.trim();
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

// 生成报告（支持联网搜索）
async function generateReport(stats, reportType) {
  const provider = await getProviderForFeature('report');
  if (!provider) throw new Error('No AI provider configured for report generation');

  const { preset, apiKey } = provider;
  const label = reportType === 'weekly' ? '周' : '月';

  const statsText = [
    `时间范围：${stats.period_start} 至 ${stats.period_end}`,
    `总上榜次数：${stats.total_appearances}，独立项目数：${stats.unique_repos}`,
    '',
    'Top 15 最活跃项目：',
    ...stats.top_repos.map((r, i) =>
      `${i + 1}. ${r.author}/${r.name}（${r.language || '未知'}）- 上榜 ${r.appearances} 次，最高排名第 ${r.peak_rank} 名，平均新增 ${r.avg_period_stars} stars\n   简介：${r.description || '无'}`
    ),
    '',
    '编程语言分布（Top 5）：',
    ...stats.language_distribution.slice(0, 5).map(l =>
      `- ${l.language}: ${l.count} 次出现 (${l.pct}%)`
    )
  ].join('\n');

  const body = {
    model: preset.models.report,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: preset.webSearch
        ? `你是一位开源技术趋势分析师。以下是 GitHub Trending ${label}报告（${stats.period_start} 至 ${stats.period_end}）的统计数据：\n\n${statsText}\n\n请先通过搜索了解以上热门项目的技术背景、近期版本发布和社区动态，然后撰写深度分析报告。要求：\n1. 基于搜索到的真实信息解释热点成因（框架发布、公司动态、热点事件等）\n2. 分析社区注意力的变化方向和演进轨迹\n3. 用 Markdown 格式输出，可包含表格，不要包含代码块\n4. 报告结构：核心洞察（3-5条）→ 详细分析 → 趋势展望\n5. 语言：中文，专业但易读`
        : `你是一位开源技术趋势分析师。以下是 GitHub Trending ${label}报告（${stats.period_start} 至 ${stats.period_end}）的统计数据：\n\n${statsText}\n\n请撰写一份深度分析报告，要求：\n1. 结合近期技术圈背景（框架发布、公司动态、热点事件等）解释热点成因\n2. 分析社区注意力的变化方向和演进轨迹\n3. 用 Markdown 格式输出，可包含表格，不要包含代码块\n4. 报告结构：核心洞察（3-5条）→ 详细分析 → 趋势展望\n5. 语言：中文，专业但易读`
    }],
  };

  // 添加联网搜索工具
  if (preset.webSearch) {
    body.tools = [{ type: 'web_search', web_search: { enable: true, search_result: true } }];
  }

  const response = await axios.post(
    `${preset.baseUrl}${preset.chatPath}`,
    body,
    {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000,
    }
  );

  return response.data.choices[0].message.content.trim();
}

// 获取某个功能可用的 provider（优先已连接的）
async function getProviderForFeature(feature) {
  const providers = await loadProviders();
  // 优先选择 status=connected 且支持该功能的
  for (const p of providers) {
    const preset = PROVIDER_PRESETS[p.id];
    if (preset && preset.features.includes(feature) && p.status === 'connected') {
      return { preset, apiKey: p.apiKey };
    }
  }
  // 退而选择任何有 key 的
  for (const p of providers) {
    const preset = PROVIDER_PRESETS[p.id];
    if (preset && preset.features.includes(feature) && p.apiKey) {
      return { preset, apiKey: p.apiKey };
    }
  }
  return null;
}

module.exports = {
  PROVIDER_PRESETS,
  getPresets,
  getConfigured,
  upsertProvider,
  removeProvider,
  testProvider,
  translate,
  translateBatch,
  generateReport,
  getProviderForFeature,
};
