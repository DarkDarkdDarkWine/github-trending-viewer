const fs = require('fs').promises;
const path = require('path');
const secretVault = require('../src/crypto/secret-vault');

const DEFAULT_CONFIG_FILE = path.join(__dirname, '..', 'data', 'ai-providers.json');

async function encryptAiKeys(options = {}) {
  const configFile = options.configFile || process.env.AI_PROVIDERS_FILE || DEFAULT_CONFIG_FILE;
  const providers = await readProviders(configFile);
  let encrypted = 0;

  const nextProviders = providers.map(provider => {
    if (!provider.apiKey || secretVault.isEncrypted(provider.apiKey)) return provider;
    encrypted += 1;
    return { ...provider, apiKey: secretVault.encrypt(provider.apiKey) };
  });

  await fs.mkdir(path.dirname(configFile), { recursive: true });
  await fs.writeFile(configFile, JSON.stringify(nextProviders, null, 2));
  return { encrypted, configFile };
}

async function readProviders(configFile) {
  try {
    const raw = await fs.readFile(configFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

if (require.main === module) {
  encryptAiKeys()
    .then(result => {
      console.log(`已加密 ${result.encrypted} 个 API Key`);
    })
    .catch(err => {
      console.error('加密 AI Provider Key 失败:', err.message);
      process.exitCode = 1;
    });
}

module.exports = { encryptAiKeys };
