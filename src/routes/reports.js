const express = require('express');
const db = require('../../db');
const { runScheduledReports } = require('../../analyzer');

const router = express.Router();

router.get('/api/generate-reports', async (req, res) => {
  try {
    const result = await runScheduledReports();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error generating reports:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/reports', async (req, res) => {
  try {
    const reports = await db.listReports();
    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/reports/:id', async (req, res) => {
  try {
    const report = await db.getReport(parseInt(req.params.id));
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
