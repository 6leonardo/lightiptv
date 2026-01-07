const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const axios = require('axios');
const CONFIG = require('../config');
const { parseM3U } = require('../parsers/m3u');
const { getEPGData } = require('./epg');

const state = {
  previewsIndex: {},
  activePreviewProcesses: new Map() // Map<sessionId, { process, channel, previewKey }>
};

/**
 * Initialize preview system
 */
async function initPreviews() {
  if (!CONFIG.PREVIEWS.ENABLED) return;
  
  try {
    await fs.mkdir(CONFIG.PREVIEWS.DIR, { recursive: true });
    
    const indexPath = path.join(CONFIG.PREVIEWS.DIR, 'index.json');
    try {
      const indexData = await fs.readFile(indexPath, 'utf8');
      state.previewsIndex = JSON.parse(indexData);
    } catch (err) {
      state.previewsIndex = {};
    }
    
    console.log('Preview system initialized');
  } catch (error) {
    console.error('Error initializing previews:', error.message);
  }
}

/**
 * Save previews index to disk atomically
 */
async function savePreviewsIndex() {
  try {
    const indexPath = path.join(CONFIG.PREVIEWS.DIR, 'index.json');
    const tempPath = indexPath + '.tmp';
    
    // Write to temp file first
    await fs.writeFile(tempPath, JSON.stringify(state.previewsIndex, null, 2));
    
    // Atomic rename
    await fs.rename(tempPath, indexPath);
  } catch (error) {
    console.error('Error saving previews index:', error.message);
  }
}

/**
 * Capture a single preview screenshot
 */
async function capturePreview(channel, program, previewKey) {
  const sessionId = `preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const programInfo = program ? `${channel.name} - ${program.title}` : channel.name;
    console.log(`[${sessionId}] Capturing preview for ${programInfo}`);
    
    const previewFile = path.join(CONFIG.PREVIEWS.DIR, `${channel.tvgId}.jpg`);
    
    const ffmpegArgs = [
      '-i', channel.stream,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      previewFile
    ];
    
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      
      // Register active process
      state.activePreviewProcesses.set(sessionId, {
        process: ffmpeg,
        channel,
        previewKey,
        startTime: Date.now()
      });
      
      let errorOutput = '';
      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        state.activePreviewProcesses.delete(sessionId);
        
        if (code === 0) {
          console.log(`[${sessionId}] Preview captured: ${channel.tvgId}`);
          resolve();
        } else {
          console.error(`[${sessionId}] FFmpeg error for ${channel.tvgId}:`, errorOutput.slice(-500));
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
      
      setTimeout(() => {
        if (ffmpeg && !ffmpeg.killed) {
          ffmpeg.kill('SIGKILL');
          state.activePreviewProcesses.delete(sessionId);
        }
        reject(new Error('Preview capture timeout'));
      }, CONFIG.PREVIEWS.CAPTURE_TIMEOUT);
    });
    
    state.previewsIndex[channel.tvgId] = {
      key: previewKey,
      status: 'success',
      timestamp: new Date().toISOString(),
      file: `${channel.tvgId}.jpg`
    };
    await savePreviewsIndex();
    
  } catch (error) {
    console.error(`[${sessionId}] Error capturing preview for ${channel.name}:`, error.message);
    
    state.previewsIndex[channel.tvgId] = {
      key: previewKey,
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    };
    await savePreviewsIndex();
  }
}

/**
 * Check and capture preview screenshots (parallel execution)
 */
async function checkAndCapturePreview(activeStreamsCount) {
  if (!CONFIG.PREVIEWS.ENABLED) return;
  
  // Calculate available slots for preview captures
  const maxPreviewSlots = CONFIG.MAX_STREAMS === 0 ? Infinity : CONFIG.MAX_STREAMS;
  const usedSlots = activeStreamsCount + state.activePreviewProcesses.size;
  const availableSlots = maxPreviewSlots - usedSlots;
  
  if (availableSlots <= 0) return;
  
  try {
    const epgData = await getEPGData();
    if (!epgData || !epgData.epgData) return;
    
    const response = await axios.get(CONFIG.THREADFIN_M3U_URL);
    const channels = parseM3U(response.data);
    
    const now = new Date();
    const candidates = [];
    
    // Find all channels that need preview update
    for (const channel of channels) {
      if (!channel.tvgId || CONFIG.PREVIEWS.EXCLUDE.includes(channel.tvgId)) continue;
      
      const programs = epgData.epgData[channel.tvgId];
      
      if (CONFIG.PREVIEWS.EPG_ONLY && (!programs || programs.length === 0)) continue;
      
      if (programs && programs.length > 0) {
        const currentProgram = programs.find(p => {
          const start = new Date(p.start);
          const stop = new Date(p.stop);
          return now >= start && now <= stop;
        });
        
        if (!currentProgram) continue;
        
        const programStart = new Date(currentProgram.start);
        const timeSinceProgramStart = now - programStart;
        
        if (timeSinceProgramStart < CONFIG.PREVIEWS.MIN_PROGRAM_AGE) continue;
        
        const previewKey = `${channel.tvgId}_${currentProgram.start}`;
        const existingPreview = state.previewsIndex[channel.tvgId];
        
        if (existingPreview && existingPreview.key === previewKey) continue;
        
        candidates.push({ channel, program: currentProgram, previewKey });
      } else if (!CONFIG.PREVIEWS.EPG_ONLY) {
        const previewKey = `${channel.tvgId}_${Math.floor(now / 3600000)}`;
        const existingPreview = state.previewsIndex[channel.tvgId];
        
        if (existingPreview && existingPreview.key === previewKey) continue;
        
        candidates.push({ channel, program: null, previewKey });
      }
    }
    
    // Start captures in parallel up to available slots
    const toCapture = candidates.slice(0, availableSlots);
    
    if (toCapture.length > 0) {
      console.log(`Starting ${toCapture.length} preview capture(s) in parallel`);
      
      // Fire and forget - don't wait for completion
      toCapture.forEach(candidate => {
        capturePreview(candidate.channel, candidate.program, candidate.previewKey)
          .catch(err => console.error('Preview capture failed:', err.message));
      });
    }
  } catch (error) {
    console.error('Error checking previews:', error.message);
  }
}

/**
 * Kill all active preview processes
 */
function killPreviewProcesses() {
  if (state.activePreviewProcesses.size === 0) return;
  
  console.log(`Killing ${state.activePreviewProcesses.size} preview process(es)...`);
  
  state.activePreviewProcesses.forEach((previewData, sessionId) => {
    if (previewData.process && !previewData.process.killed) {
      previewData.process.kill('SIGKILL');
    }
  });
  
  state.activePreviewProcesses.clear();
}

module.exports = {
  state,
  initPreviews,
  checkAndCapturePreview,
  killPreviewProcesses
};
