const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const CONFIG = require('./config');
const { getEPGData } = require('./services/epg');
const { startCleanupTask, state: streamState, setIO } = require('./services/stream');
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

// Initialize Socket.IO
const server = http.createServer(app);
const io = new Server(server);
setIO(io);

io.on('connection', (socket) => {
  console.log('Client connected');
  
  socket.on('join-stream', (sessionId) => {
    socket.join(sessionId);
    console.log(`Client joined stream room: ${sessionId}`);
  });
  
  socket.on('leave-stream', (sessionId) => {
    socket.leave(sessionId);
    console.log(`Client left stream room: ${sessionId}`);
  });
});

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

server.listen(CONFIG.PORT, start);

module.exports = app;
