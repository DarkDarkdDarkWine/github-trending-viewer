require('dotenv').config();

const express = require('express');
const cors = require('cors');
const db = require('./db');
const secretVault = require('./src/crypto/secret-vault');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use(require('./src/routes/trending'));
app.use(require('./src/routes/starred'));
app.use(require('./src/routes/translate'));
app.use(require('./src/routes/reports'));
app.use(require('./src/routes/ai-providers'));

module.exports = app;

if (process.env.NODE_ENV !== 'test') {
  const { startScheduler } = require('./scheduler');

  app.listen(PORT, async () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    if (!process.env.GITHUB_TOKEN) {
      console.warn('⚠️  GITHUB_TOKEN not set. Star status checking will be disabled.');
    }
    if (!secretVault.canEncrypt()) {
      console.warn('⚠️  ENCRYPTION_KEY not set, AI keys will be stored in plaintext (legacy mode).');
    }

    await db.ensureSchema();
    startScheduler();
  });
}
