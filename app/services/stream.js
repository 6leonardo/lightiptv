const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const CONFIG = require('../config');

const state = {
  activeStreams: new Map()
};

let io = null;

function setIO(ioInstance) {
  io = ioInstance;
}

/**
 * Cleanup stream resources
 */
async function cleanupStream(sessionId) {
  const stream = state.activeStreams.get(sessionId);
  if (!stream) return;

  if (stream.process && !stream.process.killed) {
    stream.process.kill('SIGKILL');
    console.log(`Killed ffmpeg process for ${sessionId}`);
  }

  // Use the streamDir saved in state instead of reconstructing it
  const streamDir = stream.streamDir || path.join(__dirname, '..', 'public', 'streams', sessionId);
  try {
    await fs.rm(streamDir, { recursive: true, force: true });
    console.log(`Removed directory ${streamDir}`);
  } catch (error) {
    console.error(`Error removing directory ${streamDir}:`, error.message);
  }

  state.activeStreams.delete(sessionId);
}

/**
 * Create FFmpeg process for HLS streaming
 */
function createFFmpegProcess(streamUrl, streamDir, channelName, sessionId) {
  const ffmpegArgs = [
    '-fflags', '+genpts+igndts',
    '-f', 'mpegts',
    '-i', streamUrl,
    '-map', '0:v?',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', CONFIG.FFMPEG.PRESET,
    '-tune', 'zerolatency',
    '-r', CONFIG.FFMPEG.FRAMERATE.toString(),
    '-g', CONFIG.FFMPEG.GOP_SIZE.toString(),
    '-keyint_min', CONFIG.FFMPEG.GOP_SIZE.toString(),
    '-c:a', 'aac',
    '-b:a', CONFIG.FFMPEG.AUDIO_BITRATE,
    '-f', 'hls',
    '-hls_time', CONFIG.FFMPEG.HLS_TIME.toString(),
    '-hls_list_size', CONFIG.FFMPEG.HLS_LIST_SIZE.toString(),
    '-hls_flags', 'delete_segments+append_list',
    path.join(streamDir, 'playlist.m3u8')
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);
  const ffmpegOutput = [];
  const logBuffer = [];
  
  // Setup log directory and file
  const logsDir = path.join(__dirname, '..', 'public', 'streams', 'logs');
  const sanitizedChannelName = channelName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const logFile = path.join(logsDir, `${sanitizedChannelName}.log`);
  
  // Create logs directory if it doesn't exist
  fs.mkdir(logsDir, { recursive: true }).catch(err => {
    console.error('Error creating logs directory:', err);
  });
  
  // Append stream start marker to log file
  const startMarker = `\n\n--------------------- STARTED ${new Date().toISOString()} ---------------------\n`;
  fs.appendFile(logFile, startMarker).catch(err => {
    console.error('Error writing to log file:', err);
  });

  ffmpeg.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    
    // Add to output buffer (keep last N lines)
    ffmpegOutput.push(...lines);
    if (ffmpegOutput.length > CONFIG.FFMPEG.MAX_OUTPUT_LINES) {
      ffmpegOutput.splice(0, ffmpegOutput.length - CONFIG.FFMPEG.MAX_OUTPUT_LINES);
    }
    
    // Add to polling buffer (will be cleared after read)
    logBuffer.push(...lines);
    
    // Write to log file
    fs.appendFile(logFile, lines.join('\n') + '\n').catch(err => {
      console.error('Error appending to log file:', err);
    });

    // Emit logs via WebSocket if IO is set and sessionId is provided
    if (io && sessionId) {
      io.to(sessionId).emit('log', lines);
    }
  });

  return {
    process: ffmpeg,
    output: ffmpegOutput,
    logBuffer: logBuffer,
    command: `ffmpeg ${ffmpegArgs.join(' ')}`
  };
}

/**
 * Start periodic cleanup task
 */
function startCleanupTask() {
  setInterval(() => {
    const now = Date.now();
    state.activeStreams.forEach((stream, sessionId) => {
      if (now - stream.lastAccess > CONFIG.STREAM_INACTIVITY_TIMEOUT) {
        console.log(`Stream ${sessionId} inactive, cleaning up...`);
        cleanupStream(sessionId);
      }
    });
  }, CONFIG.STREAM_CLEANUP_INTERVAL);
}

module.exports = {
  state,
  cleanupStream,
  createFFmpegProcess,
  startCleanupTask,
  setIO
};
