import dotenv from 'dotenv';
import path from 'path';
import URL from 'url';

const __dirname = path.dirname(URL.fileURLToPath(import.meta.url));

dotenv.config();

const CONFIG = {
	STREAMLINK_USER_AGENT: process.env.STREAMLINK_USER_AGENT || 'Threadfin',
	PORT: process.env.PORT ? Number(process.env.PORT) : 3005,
	THREADFIN_M3U_URL: process.env.THREADFIN_M3U_URL || process.env.M3U_URL || '',
	THREADFIN_XMLTV_URL: process.env.THREADFIN_XMLTV_URL || process.env.XMLTV_URL || '',
	LOCALE: process.env.LOCALE || 'it-IT',
	MAX_STREAMS: parseInt(process.env.MAX_STREAMS || '2', 10),
	CHANNELS: {
		DB: path.join(__dirname, '..', 'data', 'channels.json'),
		//DIR: path.join(__dirname, '..', 'data', 'channels')
	},
	LOGS: {
		DIR: path.join(__dirname, '..', 'data', 'logs')
	},
	IMAGES: {
		DIR: path.join(__dirname, '..', 'public', 'cached', 'images'),
		DIR_WEB: '/cached/images/'
	},
	STREAMS: {
		DIR: path.join(__dirname, '..', 'public', 'cached', 'streams'),
		DIR_WEB: '/cached/streams/'
	},
	EPG_CACHE_DURATION: 3600000,
	STREAM_CLEANUP_INTERVAL: 30000,
	STREAM_INACTIVITY_TIMEOUT: 10000,
	TUNER_RELEASE_TIMEOUT: 15000,
	FFMPEG: {
		HLS_TIME: 4,
		HLS_LIST_SIZE: 8,
		PRESET: 'veryfast',
		FRAMERATE: 50,
		GOP_SIZE: 100,
		AUDIO_BITRATE: '128k',
		MAX_OUTPUT_LINES: 50
	}
};

export default CONFIG;
