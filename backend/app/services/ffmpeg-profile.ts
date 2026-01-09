import CONFIG from '../config/index.js';

/**
 * Generates FFmpeg arguments for the stream.
 * This file can be mounted via Docker volume to customize FFmpeg parameters.
 */
export default function getFFmpegArgs(filename: string, streamUrl: string): string[] {
  /*
  // Legacy profile (kept for reference)
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
    filename
  ];
  */

  // Lighter CPU profile with more stable timestamps for HTML5 HLS playback.
  /*
  return [
    '-fflags', '+genpts',
    '-avoid_negative_ts', 'make_zero',
    '-i', streamUrl,
    '-map', '0:v?',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-r', CONFIG.FFMPEG.FRAMERATE.toString(),
    '-g', CONFIG.FFMPEG.GOP_SIZE.toString(),
    '-keyint_min', CONFIG.FFMPEG.GOP_SIZE.toString(),
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', CONFIG.FFMPEG.AUDIO_BITRATE,
    '-ar', '48000',
    '-ac', '2',
    '-f', 'hls',
    '-hls_time', CONFIG.FFMPEG.HLS_TIME.toString(),
    '-hls_list_size', CONFIG.FFMPEG.HLS_LIST_SIZE.toString(),
    '-hls_flags', 'delete_segments+independent_segments',
    '-hls_playlist_type', 'event',
    filename
  ];
  */

  return [
    // --- TIMESTAMP HYGIENE ---
    '-fflags', '+genpts',
    '-avoid_negative_ts', 'make_zero',

    // --- INPUT ---
    '-i', streamUrl,

    // --- STREAM SELECTION ---
    '-map', '0:v?',
    '-map', '0:a?',

    // --- VIDEO: PASS-THROUGH (CPU ~0) ---
    '-c:v', 'copy',

    // --- AUDIO: RICODIFICA STABILE ---
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ar', '48000',
    '-ac', '2',

    // --- HLS OUTPUT (MODERNO) ---
    '-f', 'hls',
    '-hls_time', CONFIG.FFMPEG.HLS_TIME.toString(),
    '-hls_list_size', CONFIG.FFMPEG.HLS_LIST_SIZE.toString(),
    '-hls_segment_type', 'fmp4',
    '-hls_flags', 'delete_segments+independent_segments',
    '-hls_playlist_type', 'event',

    filename
  ];

}
