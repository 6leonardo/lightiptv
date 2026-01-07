require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');

const app = express();
const PORT = process.env.PORT || 3005;
const THREADFIN_M3U_URL = process.env.THREADFIN_M3U_URL || process.env.M3U_URL;
const THREADFIN_XMLTV_URL = process.env.THREADFIN_XMLTV_URL || process.env.XMLTV_URL;
const PREVIEWS_ENABLED = process.env.PREVIEWS_ENABLED === 'true';
const PREVIEWS_EPG_ONLY = process.env.PREVIEWS_EPG_ONLY !== 'false'; // Default true
const PREVIEWS_EXCLUDE = process.env.PREVIEWS_EXCLUDE ? process.env.PREVIEWS_EXCLUDE.split(',').map(s => s.trim()) : [];

app.use(express.static('public'));
app.use(express.json());

// Store active streams
const activeStreams = new Map();

// Cache for EPG data
let epgCache = null;
let epgLastFetch = null;
const EPG_CACHE_DURATION = 3600000; // 1 hour

// Preview screenshot management
const previewsDir = path.join(__dirname, 'public', 'streams', 'previews');
const previewsIndexPath = path.join(previewsDir, 'index.json');
let previewsIndex = {};
let previewQueue = [];
let isCapturingPreview = false;
let previewCheckInterval = null;

// Initialize previews directory and index
async function initPreviews() {
  if (!PREVIEWS_ENABLED) return;
  
  try {
    await fs.mkdir(previewsDir, { recursive: true });
    
    // Load existing index
    try {
      const indexData = await fs.readFile(previewsIndexPath, 'utf8');
      previewsIndex = JSON.parse(indexData);
    } catch (err) {
      previewsIndex = {};
    }
    
    console.log('Preview system initialized');
  } catch (error) {
    console.error('Error initializing previews:', error.message);
  }
}

// Save previews index
async function savePreviewsIndex() {
  try {
    await fs.writeFile(previewsIndexPath, JSON.stringify(previewsIndex, null, 2));
  } catch (error) {
    console.error('Error saving previews index:', error.message);
  }
}

// Cleanup interval check (every 30 seconds)
setInterval(() => {
  const now = Date.now();
  activeStreams.forEach((stream, sessionId) => {
    // If client hasn't checked in for 60 seconds, kill ffmpeg and cleanup
    if (now - stream.lastAccess > 60000) {
      console.log(`Stream ${sessionId} inactive, cleaning up...`);
      cleanupStream(sessionId);
    }
  });
  
  // Trigger preview check when no streams are active
  if (PREVIEWS_ENABLED && activeStreams.size === 0 && !isCapturingPreview) {
    checkAndCapturePreview();
  }
}, 30000);

// Parse M3U playlist
function parseM3U(content) {
  const lines = content.split('\n');
  const channels = [];
  let currentChannel = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.startsWith('#EXTINF:')) {
      // Extract channel info
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
      const groupTitleMatch = line.match(/group-title="([^"]*)"/);
      const channelIDMatch = line.match(/channelID="([^"]*)"/);
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
      
      // Extract name from the end of the line (after last comma)
      const nameMatch = line.match(/,(.+)$/);
      
      currentChannel = {
        id: channelIDMatch ? channelIDMatch[1] : '',
        name: tvgNameMatch ? tvgNameMatch[1] : (nameMatch ? nameMatch[1] : ''),
        logo: tvgLogoMatch ? tvgLogoMatch[1] : '',
        group: groupTitleMatch ? groupTitleMatch[1] : '',
        tvgId: tvgIdMatch ? tvgIdMatch[1] : '',
        stream: ''
      };
    } else if (line && !line.startsWith('#') && currentChannel) {
      // This is the stream URL
      currentChannel.stream = line;
      channels.push(currentChannel);
      currentChannel = null;
    }
  }

  return channels;
}

// Parse XMLTV EPG data
async function parseXMLTV(xmlContent) {
  const xml2js = require('xml2js');
  const parser = new xml2js.Parser();
  
  try {
    const result = await parser.parseStringPromise(xmlContent);
    const programmes = result.tv?.programme || [];
    const channels = result.tv?.channel || [];
    
    // Organize programs by channel
    const epgData = {};
    
    programmes.forEach(program => {
      const channelId = program.$.channel;
      if (!epgData[channelId]) {
        epgData[channelId] = [];
      }
      
      const startTime = parseXMLTVTime(program.$.start);
      const endTime = parseXMLTVTime(program.$.stop);
      
      // Parse category - can be string or object with _ property
      let category = '';
      if (program.category && program.category.length > 0) {
        const cat = program.category[0];
        category = typeof cat === 'string' ? cat : (cat._ || '');
      }
      
      // Parse title
      let title = '';
      if (program.title && program.title.length > 0) {
        const t = program.title[0];
        title = typeof t === 'string' ? t : (t._ || '');
      }
      
      // Parse description
      let desc = '';
      if (program.desc && program.desc.length > 0) {
        const d = program.desc[0];
        desc = typeof d === 'string' ? d : (d._ || '');
      }
      
      epgData[channelId].push({
        channelId,
        start: startTime,
        stop: endTime,
        title,
        desc,
        category
      });
    });
    
    // Sort programs by start time
    Object.keys(epgData).forEach(channelId => {
      epgData[channelId].sort((a, b) => new Date(a.start) - new Date(b.start));
    });
    
    return { epgData, channels };
  } catch (error) {
    console.error('Error parsing XMLTV:', error.message);
    return { epgData: {}, channels: [] };
  }
}

// Parse XMLTV timestamp format (YYYYMMDDHHmmss +TZ)
function parseXMLTVTime(timeStr) {
  if (!timeStr) return null;
  
  const year = timeStr.substr(0, 4);
  const month = timeStr.substr(4, 2);
  const day = timeStr.substr(6, 2);
  const hour = timeStr.substr(8, 2);
  const minute = timeStr.substr(10, 2);
  const second = timeStr.substr(12, 2);
  
  // Parse timezone offset (e.g., +0100)
  const tzMatch = timeStr.match(/([+-]\d{4})$/);
  if (tzMatch) {
    const tzOffset = tzMatch[1];
    const tzSign = tzOffset[0];
    const tzHours = parseInt(tzOffset.substr(1, 2));
    const tzMinutes = parseInt(tzOffset.substr(3, 2));
    
    // Create date in UTC and adjust for timezone
    const utcDate = new Date(Date.UTC(
      parseInt(year), 
      parseInt(month) - 1, 
      parseInt(day), 
      parseInt(hour), 
      parseInt(minute), 
      parseInt(second)
    ));
    
    // Adjust for timezone offset to get local time
    const offsetMs = (tzSign === '+' ? -1 : 1) * ((tzHours * 60 + tzMinutes) * 60000);
    return new Date(utcDate.getTime() + offsetMs);
  }
  
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
}

// Fetch and cache EPG data
async function getEPGData() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (epgCache && epgLastFetch && (now - epgLastFetch < EPG_CACHE_DURATION)) {
    return epgCache;
  }
  
  try {
    console.log('Fetching EPG data...');
    const response = await axios.get(THREADFIN_XMLTV_URL);
    const parsed = await parseXMLTV(response.data);
    
    epgCache = parsed;
    epgLastFetch = now;
    
    console.log('EPG data cached successfully');
    return epgCache;
  } catch (error) {
    console.error('Error fetching EPG:', error.message);
    return epgCache || { epgData: {}, channels: [] };
  }
}

// Proxy endpoint for logos (to avoid mixed content issues)
app.get('/api/logo-proxy', async (req, res) => {
  try {
    const logoUrl = req.query.url;
    if (!logoUrl) {
      return res.status(400).send('Missing url parameter');
    }
    
    const response = await axios.get(logoUrl, {
      responseType: 'arraybuffer',
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    
    const contentType = response.headers['content-type'] || 'image/png';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400'); // Cache 24h
    res.send(response.data);
  } catch (error) {
    console.error('Error proxying logo:', error.message);
    res.status(404).send('Logo not found');
  }
});

// API endpoint to get channels
app.get('/api/channels', async (req, res) => {
  try {
    const response = await axios.get(THREADFIN_M3U_URL);
    const channels = parseM3U(response.data);
    
    // Add streaming status to channels
    const activeStreamUrls = new Set();
    activeStreams.forEach(stream => {
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

// Cleanup function
async function cleanupStream(sessionId) {
  const stream = activeStreams.get(sessionId);
  if (!stream) return;

  // Kill ffmpeg process
  if (stream.process && !stream.process.killed) {
    stream.process.kill('SIGKILL');
    console.log(`Killed ffmpeg process for ${sessionId}`);
  }

  // Remove directory
  const streamDir = path.join(__dirname, 'public', 'streams', sessionId);
  try {
    await fs.rm(streamDir, { recursive: true, force: true });
    console.log(`Removed directory ${streamDir}`);
  } catch (error) {
    console.error(`Error removing directory ${streamDir}:`, error.message);
  }

  activeStreams.delete(sessionId);
}

// Start stream endpoint
app.post('/api/stream/start', async (req, res) => {
  const { streamUrl, channelName } = req.body;
  
  if (!streamUrl) {
    return res.status(400).json({ error: 'Stream URL required' });
  }

  // Build base URL from request
  const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const baseUrl = `${protocol}://${host}`;

  // Check if stream already exists for this URL
  for (const [existingSessionId, stream] of activeStreams.entries()) {
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

  // Generate unique session ID
  const sessionId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const streamDir = path.join(__dirname, 'public', 'streams', sessionId);
  const m3u8Path = path.join(streamDir, 'playlist.m3u8');
  const m3u8Url = `${baseUrl}/streams/${sessionId}/playlist.m3u8`;

  try {
    // Create stream directory
    await fs.mkdir(streamDir, { recursive: true });

    // Spawn ffmpeg process
    const ffmpegArgs = [
      //'-use_wallclock_as_timestamps', '1',
      '-fflags', '+genpts+igndts',
      '-f', 'mpegts',
      '-i', streamUrl,
      '-map', '0:v?',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-r', '50',
      '-g', '100',
      '-keyint_min', '100',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_list_size', '8',
      '-hls_flags', 'delete_segments+append_list',
      path.join(streamDir, 'playlist.m3u8')
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    let ffmpegOutput = [];
    const maxOutputLines = 50; // Keep last 50 lines

    ffmpeg.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      ffmpegOutput.push(...lines);
      // Keep only last maxOutputLines
      if (ffmpegOutput.length > maxOutputLines) {
        ffmpegOutput = ffmpegOutput.slice(-maxOutputLines);
      }
    });

    ffmpeg.on('error', (error) => {
      console.error(`FFmpeg error [${sessionId}]:`, error);
      cleanupStream(sessionId);
    });

    ffmpeg.on('close', (code) => {
      console.log(`FFmpeg process [${sessionId}] exited with code ${code}`);
      if (activeStreams.has(sessionId)) {
        cleanupStream(sessionId);
      }
    });

    // Store stream info
    activeStreams.set(sessionId, {
      process: ffmpeg,
      streamUrl,
      channelName,
      startTime: Date.now(),
      lastAccess: Date.now(),
      m3u8Path,
      streamDir,
      ffmpegOutput,
      ffmpegCommand: `ffmpeg ${ffmpegArgs.join(' ')}`
    });

    console.log(`Started stream ${sessionId} for ${channelName}`);
    
    res.json({ 
      sessionId,
      m3u8Url,
      message: 'Stream started' 
    });

  } catch (error) {
    console.error('Error starting stream:', error);
    res.status(500).json({ error: 'Failed to start stream' });
  }
});

// Check stream status with progress
app.get('/api/stream/status/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const stream = activeStreams.get(sessionId);

  if (!stream) {
    return res.json({ ready: false, error: 'Stream not found', progress: 0 });
  }

  // Update last access time
  stream.lastAccess = Date.now();

  // Check stream progress
  try {
    const files = await fs.readdir(stream.streamDir);
    const tsFiles = files.filter(f => f.endsWith('.ts')).sort();
    const m3u8Exists = files.includes('playlist.m3u8');
    
    // Calculate progress (0-100%)
    // We expect at least 2 TS files (20 seconds total) before ready
    const elapsedTime = Date.now() - stream.startTime;
    const maxWaitTime = 20000; // 20 seconds max wait
    const timeProgress = Math.min((elapsedTime / maxWaitTime) * 100, 100);
    
    // Check if we have at least second TS file (index 1)
    const hasSecondTs = tsFiles.length >= 2;
    const ready = hasSecondTs && m3u8Exists;
    
    // Get last 20 lines of ffmpeg output
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

// Stop stream endpoint
app.post('/api/stream/stop/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  
  await cleanupStream(sessionId);
  
  res.json({ message: 'Stream stopped' });
});

// Heartbeat to keep stream alive
app.post('/api/stream/heartbeat/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const stream = activeStreams.get(sessionId);

  if (stream) {
    stream.lastAccess = Date.now();
    res.json({ status: 'ok' });
  } else {
    res.status(404).json({ error: 'Stream not found' });
  }
});

// Check and capture preview screenshots
async function checkAndCapturePreview() {
  if (!PREVIEWS_ENABLED || isCapturingPreview || activeStreams.size > 0) return;
  
  try {
    const epgData = await getEPGData();
    if (!epgData || !epgData.epgData) return;
    
    const response = await axios.get(THREADFIN_M3U_URL);
    const channels = parseM3U(response.data);
    
    const now = new Date();
    const candidates = [];
    
    // Find channels with EPG that need preview update
    for (const channel of channels) {
      if (!channel.tvgId || PREVIEWS_EXCLUDE.includes(channel.tvgId)) continue;
      
      const programs = epgData.epgData[channel.tvgId];
      
      // Skip if PREVIEWS_EPG_ONLY is true and no EPG data
      if (PREVIEWS_EPG_ONLY && (!programs || programs.length === 0)) continue;
      
      // If we have EPG, check for current program
      let currentProgram = null;
      if (programs && programs.length > 0) {
        currentProgram = programs.find(p => {
          const start = new Date(p.start);
          const stop = new Date(p.stop);
          return now >= start && now <= stop;
        });
        
        if (!currentProgram) continue;
        
        const programStart = new Date(currentProgram.start);
        const timeSinceProgramStart = now - programStart;
        const fiveMinutes = 5 * 60 * 1000;
        
        // Check if program started at least 5 minutes ago
        if (timeSinceProgramStart < fiveMinutes) continue;
        
        // Check if we already have a preview for this program
        const previewKey = `${channel.tvgId}_${currentProgram.start}`;
        if (previewsIndex[channel.tvgId] === previewKey) continue;
        
        candidates.push({
          channel,
          program: currentProgram,
          previewKey
        });
      } else if (!PREVIEWS_EPG_ONLY) {
        // No EPG but PREVIEWS_EPG_ONLY is false - capture anyway
        const previewKey = `${channel.tvgId}_${Math.floor(now / 3600000)}`; // Hourly key
        if (previewsIndex[channel.tvgId] === previewKey) continue;
        
        candidates.push({
          channel,
          program: null,
          previewKey
        });
      }
    }
    
    // Process one candidate at a time
    if (candidates.length > 0) {
      const candidate = candidates[0];
      await capturePreview(candidate.channel, candidate.program, candidate.previewKey);
    }
  } catch (error) {
    console.error('Error checking previews:', error.message);
  }
}

// Capture a single preview screenshot
async function capturePreview(channel, program, previewKey) {
  isCapturingPreview = true;
  
  try {
    const programInfo = program ? `${channel.name} - ${program.title}` : channel.name;
    console.log(`Capturing preview for ${programInfo}`);
    
    const previewFile = path.join(previewsDir, `${channel.tvgId}.jpg`);
    
    // Use FFmpeg to capture one frame
    const ffmpegArgs = [
      '-i', channel.stream,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      previewFile
    ];
    
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      
      let errorOutput = '';
      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log(`Preview captured: ${channel.tvgId}`);
          resolve();
        } else {
          console.error(`FFmpeg error for ${channel.tvgId}:`, errorOutput.slice(-500));
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        ffmpeg.kill('SIGKILL');
        reject(new Error('Preview capture timeout'));
      }, 30000);
    });
    
    // Update index
    previewsIndex[channel.tvgId] = previewKey;
    await savePreviewsIndex();
    
  } catch (error) {
    console.error(`Error capturing preview for ${channel.name}:`, error.message);
  } finally {
    isCapturingPreview = false;
  }
}


// EPG endpoint
app.get('/api/epg', async (req, res) => {
  try {
    const epgData = await getEPGData();
    res.json(epgData);
  } catch (error) {
    console.error('Error getting EPG:', error.message);
    res.status(500).json({ error: 'Failed to get EPG data' });
  }
});

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Threadfin M3U URL: ${THREADFIN_M3U_URL}`);
  console.log(`Threadfin XMLTV URL: ${THREADFIN_XMLTV_URL}`);
  console.log(`Previews enabled: ${PREVIEWS_ENABLED}`);
  
  // Pre-load EPG data on startup
  console.log('Loading EPG data...');
  await getEPGData();
  console.log('EPG data loaded');
  
  // Initialize preview system
  if (PREVIEWS_ENABLED) {
    await initPreviews();
  }
});
