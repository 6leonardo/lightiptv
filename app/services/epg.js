const axios = require('axios');
const CONFIG = require('../config');
const { parseXMLTV } = require('../parsers/xmltv');

const state = {
  epgCache: null,
  epgLastFetch: null
};

/**
 * Fetch and cache EPG data
 */
async function getEPGData() {
  const now = Date.now();
  
  if (state.epgCache && state.epgLastFetch && (now - state.epgLastFetch < CONFIG.EPG_CACHE_DURATION)) {
    return state.epgCache;
  }
  
  try {
    console.log('Fetching EPG data...');
    const response = await axios.get(CONFIG.THREADFIN_XMLTV_URL);
    const parsed = await parseXMLTV(response.data);
    
    state.epgCache = parsed;
    state.epgLastFetch = now;
    
    console.log('EPG data cached successfully');
    return state.epgCache;
  } catch (error) {
    console.error('Error fetching EPG:', error.message);
    return state.epgCache || { epgData: {}, channels: [] };
  }
}

module.exports = { getEPGData };
