const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const CONFIG = require('../config');

const state = {
  activeStreams: new Map()
};

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

  const streamDir = path.join(__dirname, '..', 'public', 'streams', sessionId);
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
function createFFmpegProcess(streamUrl, streamDir) {
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

  ffmpeg.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    ffmpegOutput.push(...lines);
    if (ffmpegOutput.length > CONFIG.FFMPEG.MAX_OUTPUT_LINES) {
      ffmpegOutput.splice(0, ffmpegOutput.length - CONFIG.FFMPEG.MAX_OUTPUT_LINES);
    }
  });

  return {
    process: ffmpeg,
    output: ffmpegOutput,
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
  startCleanupTask
};
