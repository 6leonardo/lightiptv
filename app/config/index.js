require('dotenv').config();
const path = require('path');

const CONFIG = {
  PORT: process.env.PORT || 3005,
  THREADFIN_M3U_URL: process.env.THREADFIN_M3U_URL || process.env.M3U_URL,
  THREADFIN_XMLTV_URL: process.env.THREADFIN_XMLTV_URL || process.env.XMLTV_URL,
  MAX_STREAMS: parseInt(process.env.MAX_STREAMS || '2', 10),
  LOGOS: {
    DIR: path.join(__dirname, '..', 'public', 'streams', 'logos')
  },
  PREVIEWS: {
    ENABLED: process.env.PREVIEWS_ENABLED === 'true',
    EPG_ONLY: process.env.PREVIEWS_EPG_ONLY !== 'false',
    EXCLUDE: process.env.PREVIEWS_EXCLUDE ? process.env.PREVIEWS_EXCLUDE.split(',').map(s => s.trim()) : [],
    DIR: path.join(__dirname, '..', 'public', 'streams', 'previews'),
    MIN_PROGRAM_AGE: 5 * 60 * 1000, // 5 minutes
    CAPTURE_TIMEOUT: 30000 // 30 seconds
  },
  EPG_CACHE_DURATION: 3600000, // 1 hour
  STREAM_CLEANUP_INTERVAL: 30000, // 30 seconds
  STREAM_INACTIVITY_TIMEOUT: 60000, // 60 seconds
  FFMPEG: {
    HLS_TIME: 4,
    HLS_LIST_SIZE: 8,
    PRESET: 'veryfast',
    FRAMERATE: 50,
    GOP_SIZE: 100,
    AUDIO_BITRATE: '128k',
    MAX_OUTPUT_LINES: 50
  }
};

module.exports = CONFIG;
