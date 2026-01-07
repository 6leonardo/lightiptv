const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const CONFIG = require('../config');
const { parseM3U } = require('../parsers/m3u');
const { state: streamState } = require('../services/stream');
const { state: previewState } = require('../services/preview');

const router = express.Router();

/**
 * Initialize logos cache directory
 */
async function initLogosCache() {
  try {
    // Clean up old logos on startup
    try {
      await fs.rm(CONFIG.LOGOS.DIR, { recursive: true, force: true });
    } catch (err) {
      // Ignore if doesn't exist
    }
    
    // Create fresh directory
    await fs.mkdir(CONFIG.LOGOS.DIR, { recursive: true });
    console.log('Logos cache initialized');
  } catch (error) {
    console.error('Error initializing logos cache:', error.message);
  }
}

// Initialize on module load
initLogosCache();

/**
 * Get channels with streaming status
 */
router.get('/channels', async (req, res) => {
  try {
    const response = await axios.get(CONFIG.THREADFIN_M3U_URL);
    const channels = parseM3U(response.data);
    
    const activeStreamUrls = new Set();
    streamState.activeStreams.forEach(stream => {
      activeStreamUrls.add(stream.streamUrl);
    });
    
    const channelsWithStatus = channels.map(channel => ({
      ...channel,
      isStreaming: activeStreamUrls.has(channel.stream)
    }));
    
    res.json({ channels: channelsWithStatus });
  } catch (error) {
    console.error('Error fetching M3U:', error.message);
    res.status(500).json({ error: 'Failed to fetch M3U playlist' });
  }
});

/**
 * Logo proxy with disk cache
 */
router.get('/logo-proxy', async (req, res) => {
  try {
    const logoUrl = req.query.url;
    if (!logoUrl) {
      return res.status(400).send('Missing url parameter');
    }
    
    // Generate cache filename from URL hash
    const hash = crypto.createHash('md5').update(logoUrl).digest('hex');
    const ext = path.extname(new URL(logoUrl).pathname) || '.png';
    const cacheFile = path.join(CONFIG.LOGOS.DIR, `${hash}${ext}`);
    
    // Check if cached file exists
    try {
      const cachedData = await fs.readFile(cacheFile);
      const contentType = ext === '.svg' ? 'image/svg+xml' : 
                          ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 
                          ext === '.gif' ? 'image/gif' : 'image/png';
      
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(cachedData);
    } catch (err) {
      // Not in cache, download it
    }
    
    // Download and cache
    const response = await axios.get(logoUrl, {
      responseType: 'arraybuffer',
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const contentType = response.headers['content-type'] || 'image/png';
    
    // Save to cache
    await fs.writeFile(cacheFile, response.data);
    
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(response.data);
  } catch (error) {
    console.error('Error proxying logo:', error.message);
    res.status(404).send('Logo not found');
  }
});

/**
 * Get previews index (atomic read from memory)
 */
router.get('/previews-index', (req, res) => {
  console.log('GET /api/previews-index - returning', Object.keys(previewState.previewsIndex).length, 'previews');
  res.json(previewState.previewsIndex);
});

module.exports = router;
