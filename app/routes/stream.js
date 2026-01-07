const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const CONFIG = require('../config');
const { state: streamState, cleanupStream, createFFmpegProcess } = require('../services/stream');
const { killPreviewProcesses } = require('../services/preview');

const router = express.Router();

/**
 * Start a new stream
 */
router.post('/start', async (req, res) => {
  const { streamUrl, channelName } = req.body;
  
  if (!streamUrl) {
    return res.status(400).json({ error: 'Stream URL required' });
  }

  const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const baseUrl = `${protocol}://${host}`;

  // Check for existing stream
  for (const [existingSessionId, stream] of streamState.activeStreams.entries()) {
    if (stream.streamUrl === streamUrl) {
      console.log(`Reusing existing stream ${existingSessionId} for ${channelName}`);
      stream.lastAccess = Date.now();
      return res.json({
        sessionId: existingSessionId,
        m3u8Url: `${baseUrl}/streams/${existingSessionId}/playlist.m3u8`,
        message: 'Using existing stream',
        reused: true
      });
    }
  }

  // Check stream limit
  if (CONFIG.MAX_STREAMS > 0 && streamState.activeStreams.size >= CONFIG.MAX_STREAMS) {
    console.log(`Max streams limit reached (${CONFIG.MAX_STREAMS}), rejecting new stream request`);
    return res.status(429).json({ 
      error: 'Max streams limit reached',
      maxStreams: CONFIG.MAX_STREAMS,
      activeStreams: streamState.activeStreams.size
    });
  }

  // Kill all preview processes to free up slots
  killPreviewProcesses();

  const sessionId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const streamDir = path.join(__dirname, '..', 'public', 'streams', sessionId);

  try {
    await fs.mkdir(streamDir, { recursive: true });

    const { process: ffmpeg, output: ffmpegOutput, command: ffmpegCommand } = createFFmpegProcess(streamUrl, streamDir);

    ffmpeg.on('error', (error) => {
      console.error(`FFmpeg error [${sessionId}]:`, error);
      cleanupStream(sessionId);
    });

    ffmpeg.on('close', (code) => {
      console.log(`FFmpeg process [${sessionId}] exited with code ${code}`);
      if (streamState.activeStreams.has(sessionId)) {
        cleanupStream(sessionId);
      }
    });

    streamState.activeStreams.set(sessionId, {
      process: ffmpeg,
      streamUrl,
      channelName,
      startTime: Date.now(),
      lastAccess: Date.now(),
      streamDir,
      ffmpegOutput,
      ffmpegCommand
    });

    console.log(`Started stream ${sessionId} for ${channelName}`);
    
    res.json({ 
      sessionId,
      m3u8Url: `${baseUrl}/streams/${sessionId}/playlist.m3u8`,
      message: 'Stream started' 
    });

  } catch (error) {
    console.error('Error starting stream:', error);
    res.status(500).json({ error: 'Failed to start stream' });
  }
});

/**
 * Get stream status
 */
router.get('/status/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const stream = streamState.activeStreams.get(sessionId);

  if (!stream) {
    return res.json({ ready: false, error: 'Stream not found', progress: 0 });
  }

  stream.lastAccess = Date.now();

  try {
    const files = await fs.readdir(stream.streamDir);
    const tsFiles = files.filter(f => f.endsWith('.ts')).sort();
    const m3u8Exists = files.includes('playlist.m3u8');
    
    const elapsedTime = Date.now() - stream.startTime;
    const maxWaitTime = 20000;
    const timeProgress = Math.min((elapsedTime / maxWaitTime) * 100, 100);
    
    const hasSecondTs = tsFiles.length >= 2;
    const ready = hasSecondTs && m3u8Exists;
    
    const outputLines = stream.ffmpegOutput.slice(-20);
    
    res.json({ 
      ready,
      tsCount: tsFiles.length,
      m3u8Exists,
      progress: ready ? 100 : Math.floor(timeProgress),
      elapsedTime: Math.floor(elapsedTime / 1000),
      m3u8Url: `/streams/${sessionId}/playlist.m3u8`,
      ffmpegCommand: stream.ffmpegCommand,
      ffmpegOutput: outputLines
    });
  } catch (error) {
    res.json({ ready: false, error: 'Error checking stream status', progress: 0 });
  }
});

/**
 * Stop stream
 */
router.post('/stop/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  await cleanupStream(sessionId);
  res.json({ message: 'Stream stopped' });
});

/**
 * Stream heartbeat
 */
router.post('/heartbeat/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const stream = streamState.activeStreams.get(sessionId);

  if (stream) {
    stream.lastAccess = Date.now();
    res.json({ status: 'ok' });
  } else {
    res.status(404).json({ error: 'Stream not found' });
  }
});

module.exports = router;
