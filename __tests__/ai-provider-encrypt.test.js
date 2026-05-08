const fs = require('fs').promises;
const os = require('os');
const path = require('path');

describe('ai-provider encrypted storage', () => {
  let dir;
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalProvidersFile = process.env.AI_PROVIDERS_FILE;
  const originalTaskFile = process.env.AI_TASK_ASSIGN_FILE;

  beforeEach(async () => {
    jest.resetModules();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-provider-test-'));
    process.env.AI_PROVIDERS_FILE = path.join(dir, 'ai-providers.json');
    process.env.AI_TASK_ASSIGN_FILE = path.join(dir, 'ai-task-assign.json');
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  afterAll(() => {
    restoreEnv('ENCRYPTION_KEY', originalKey);
    restoreEnv('AI_PROVIDERS_FILE', originalProvidersFile);
    restoreEnv('AI_TASK_ASSIGN_FILE', originalTaskFile);
  });

  test('saves encrypted API keys and does not expose them in presets', async () => {
    const aiProvider = require('../ai-provider');

    await aiProvider.upsertProvider('deepseek', 'sk-secret');
    const raw = await fs.readFile(process.env.AI_PROVIDERS_FILE, 'utf8');
    const stored = JSON.parse(raw);

    expect(stored[0].apiKey).toMatch(/^enc:v1:/);
    expect(stored[0].apiKey).not.toContain('sk-secret');

    jest.resetModules();
    const reloaded = require('../ai-provider');
    const provider = await reloaded.getProviderForFeature('translate');
    const presets = await reloaded.getPresets();

    expect(provider.apiKey).toBe('sk-secret');
    expect(presets.find(p => p.id === 'deepseek')).toMatchObject({
      configured: true,
      hasApiKey: true,
      apiKey: ''
    });
  });

  test('keeps an existing key when upsert receives an empty key', async () => {
    const aiProvider = require('../ai-provider');

    await aiProvider.upsertProvider('deepseek', 'sk-secret');
    await aiProvider.upsertProvider('deepseek', '');

    jest.resetModules();
    const reloaded = require('../ai-provider');
    const provider = await reloaded.getProviderForFeature('translate');

    expect(provider.apiKey).toBe('sk-secret');
  });

  test('can read legacy plaintext keys', async () => {
    await fs.writeFile(process.env.AI_PROVIDERS_FILE, JSON.stringify([{
      id: 'deepseek',
      apiKey: 'legacy-secret',
      status: 'connected',
      selectedModels: { translate: 'deepseek-chat', report: 'deepseek-chat' }
    }]));

    const aiProvider = require('../ai-provider');
    const provider = await aiProvider.getProviderForFeature('translate');

    expect(provider.apiKey).toBe('legacy-secret');
  });

  test('falls back to plaintext storage when encryption key is missing', async () => {
    delete process.env.ENCRYPTION_KEY;
    const aiProvider = require('../ai-provider');

    await aiProvider.upsertProvider('deepseek', 'sk-legacy-mode');
    const raw = await fs.readFile(process.env.AI_PROVIDERS_FILE, 'utf8');

    expect(raw).toContain('sk-legacy-mode');
  });
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
