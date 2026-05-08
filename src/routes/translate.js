const express = require('express');
const { streamTranslations } = require('../services/translate-stream');

const router = express.Router();

router.post('/api/translate', async (req, res) => {
  const { texts } = req.body;
  if (!texts || texts.length === 0) {
    return res.status(400).json({ error: 'No texts provided' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let closed = false;
  req.on('close', () => { closed = true; });

  await streamTranslations(texts, (payload) => {
    if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  });

  if (!closed) res.end();
});

module.exports = router;
