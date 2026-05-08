const aiProvider = require('../../ai-provider');
const { asyncPool } = require('../lib/async-pool');

async function streamTranslations(texts, writeFn, options = {}) {
  const concurrency = options.concurrency || 4;
  await asyncPool(concurrency, texts, async ({ index, text }) => {
    try {
      const translation = await aiProvider.translate(text);
      writeFn({ index, translation });
    } catch (err) {
      writeFn({ index, error: true, message: err.message });
    }
  });
}

module.exports = { streamTranslations };
