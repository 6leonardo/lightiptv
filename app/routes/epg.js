const express = require('express');
const { getEPGData } = require('../services/epg');

const router = express.Router();

/**
 * Get EPG data
 */
router.get('/epg', async (req, res) => {
  try {
    const epgData = await getEPGData();
    res.json(epgData);
  } catch (error) {
    console.error('Error getting EPG:', error.message);
    res.status(500).json({ error: 'Failed to get EPG data' });
  }
});

module.exports = router;
