import CONFIG from '../config/index.js';

/**
 * Generates FFmpeg arguments for the stream.
 * This file can be mounted via Docker volume to customize FFmpeg parameters.
 */
export default function getFFmpegArgs(filename: string, streamUrl: string = "pipe:0"): string[] {

	// Legacy profile (kept for reference)
	/*
	return [
		'-user_agent', 'Threadfin',
		'-fflags', '+genpts+igndts',
		'-avoid_negative_ts', 'make_zero',

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
	/*
	return [
		'-user_agent', 'Threadfin',

		// --- TIMESTAMP HYGIENE ---
		'-fflags', '+genpts+discardcorrupt',
		'-avoid_negative_ts', 'make_zero',

		//--------
		'-reconnect', '1',
		'-reconnect_streamed', '1',
		'-reconnect_delay_max', '2',
		'-allowed_extensions', 'ALL',
		'-protocol_whitelist', 'file,http,https,tcp,tls',
		'-analyzeduration', '1000000',
		'-probesize', '1000000',
		// --- INPUT ---
		'-i', streamUrl,

		// --- STREAM SELECTION ---
		'-map', '0:v?',
		'-map', '0:a?',

		// --- VIDEO: PASS THROUGH ---
		'-c:v', 'copy',

		// --- AUDIO: FIX TEMPORALE ---
		'-c:a', 'aac',
		'-b:a', '96k',
		'-ar', '48000',
		'-ac', '2',
		'-af', 'aresample=async=1000:first_pts=0',

		// --- HLS OUTPUT ---
		'-f', 'hls',
		'-hls_time', CONFIG.FFMPEG.HLS_TIME.toString(),
		'-hls_list_size', CONFIG.FFMPEG.HLS_LIST_SIZE.toString(),
		'-hls_segment_type', 'mpegts',
		'-hls_flags', 'delete_segments+independent_segments',
		'-hls_playlist_type', 'event',

		filename
	];
	*/

	if (streamUrl === "pipe:0")
		return [
			// --- INPUT ROBUSTNESS ---
			'-fflags', '+genpts+discardcorrupt',
			'-avoid_negative_ts', 'make_zero',
			'-analyzeduration', '8000000',
			'-probesize', '8000000',

			// --- INPUT ---
			'-i', streamUrl,

			// --- STREAM SELECTION ---
			'-map', '0:v:0',
			'-map', '0:a:0',

			// --- PASS THROUGH TOTALE ---
			'-c:v', 'copy',
			'-c:a', 'copy',

			// --- HLS OUTPUT ---
			'-f', 'hls',
			'-hls_time', CONFIG.FFMPEG.HLS_TIME.toString(),
			'-hls_list_size', CONFIG.FFMPEG.HLS_LIST_SIZE.toString(),
			'-hls_segment_type', 'mpegts',
			'-hls_flags', 'delete_segments+independent_segments',
			'-hls_playlist_type', 'event',

			filename
		];

	else
		return [
			'-user_agent', 'Threadfin',

			// --- INPUT ROBUSTNESS ---
			'-fflags', '+genpts+discardcorrupt',
			'-avoid_negative_ts', 'make_zero',
			'-analyzeduration', '2000000',
			'-probesize', '2000000',

			'-reconnect', '1',
			'-reconnect_streamed', '1',
			'-reconnect_delay_max', '2',
			'-allowed_extensions', 'ALL',
			'-protocol_whitelist', 'file,http,https,tcp,tls,crypto,pipe',

			// --- INPUT ---
			'-i', streamUrl,

			// --- STREAM SELECTION ---
			'-map', '0:v:0',
			'-map', '0:a:0',

			// --- PASS THROUGH TOTALE ---
			'-c:v', 'copy',
			'-c:a', 'copy',

			// --- HLS OUTPUT ---
			'-f', 'hls',
			'-hls_time', CONFIG.FFMPEG.HLS_TIME.toString(),
			'-hls_list_size', CONFIG.FFMPEG.HLS_LIST_SIZE.toString(),
			'-hls_segment_type', 'mpegts',
			'-hls_flags', 'delete_segments+independent_segments',
			'-hls_playlist_type', 'event',

			filename
		];



}
