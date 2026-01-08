const path = require('path');
const CONFIG = require('../config');

/**
 * Generates FFmpeg arguments for the stream.
 * This file can be mounted via Docker volume to customize FFmpeg parameters.
 * 
 * @param {string} streamUrl - The source URL of the stream
 * @param {string} streamDir - The output directory for HLS segments
 * @returns {string[]} Array of FFmpeg arguments
 */
module.exports = function(streamUrl, streamDir) {
  return [
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
};
