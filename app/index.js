const express = require('express');
const path = require('path');
const CONFIG = require('./config');
const { getEPGData } = require('./services/epg');
const { startCleanupTask, state: streamState } = require('./services/stream');
const { initPreviews, checkAndCapturePreview } = require('./services/preview');

// Routes
const channelsRouter = require('./routes/channels');
const epgRouter = require('./routes/epg');
const streamRouter = require('./routes/stream');

const app = express();

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API Routes
app.use('/api', channelsRouter);
app.use('/api', epgRouter);
app.use('/api/stream', streamRouter);

/**
 * Start periodic tasks
 */
function startPeriodicTasks() {
  // Stream cleanup
  startCleanupTask();
  
  // Preview generation
  setInterval(() => {
    if (CONFIG.PREVIEWS.ENABLED) {
      checkAndCapturePreview(streamState.activeStreams.size);
    }
  }, CONFIG.STREAM_CLEANUP_INTERVAL);
}

/**
 * Initialize and start server
 */
async function start() {
  console.log(`Server running on http://localhost:${CONFIG.PORT}`);
  console.log(`Threadfin M3U URL: ${CONFIG.THREADFIN_M3U_URL}`);
  console.log(`Threadfin XMLTV URL: ${CONFIG.THREADFIN_XMLTV_URL}`);
  console.log(`Max streams: ${CONFIG.MAX_STREAMS === 0 ? 'unlimited' : CONFIG.MAX_STREAMS}`);
  console.log(`Previews enabled: ${CONFIG.PREVIEWS.ENABLED}`);
  
  console.log('Loading EPG data...');
  await getEPGData();
  console.log('EPG data loaded');
  
  if (CONFIG.PREVIEWS.ENABLED) {
    await initPreviews();
  }
  
  startPeriodicTasks();
}

app.listen(CONFIG.PORT, start);

module.exports = app;
