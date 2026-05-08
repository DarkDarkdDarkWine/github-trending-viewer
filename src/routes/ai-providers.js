const express = require('express');
const aiProvider = require('../../ai-provider');

const router = express.Router();

router.get('/api/ai-providers', async (req, res) => {
  try {
    const presets = await aiProvider.getPresets();
    res.json({ success: true, data: presets });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/ai-providers', async (req, res) => {
  try {
    const { id, apiKey } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    const result = await aiProvider.upsertProvider(id, apiKey || '');
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/api/ai-providers/:id', async (req, res) => {
  try {
    await aiProvider.removeProvider(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/ai-providers/test', async (req, res) => {
  try {
    const { id, apiKey, model } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    const result = await aiProvider.testProvider(id, apiKey, model);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/ai-providers/models', async (req, res) => {
  try {
    const { id, apiKey } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    const models = await aiProvider.fetchModels(id, apiKey);
    res.json({ success: true, data: models });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/ai-providers/task-assign', async (req, res) => {
  try {
    const assign = await aiProvider.getTaskAssign();
    res.json({ success: true, data: assign });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/ai-providers/task-assign', async (req, res) => {
  try {
    const result = await aiProvider.updateTaskAssign(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/ai-providers/:id/models', async (req, res) => {
  try {
    const { selectedModels } = req.body;
    if (!selectedModels) return res.status(400).json({ success: false, error: 'selectedModels required' });
    const result = await aiProvider.updateModels(req.params.id, selectedModels);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
