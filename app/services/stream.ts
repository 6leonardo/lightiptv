import fs from 'fs';
import path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { Server as SocketIOServer } from 'socket.io';
import { channelService } from './channels.js';
import CONFIG from '../config/index.js';
import getFFmpegArgs from './ffmpeg-profile.js';

function sanitizeChannelName(channelName: string): string {
	return channelName.replace(/[^a-zA-Z0-9-_]/g, '_');
}

class Stream {
	logStream: fs.WriteStream | null = null;
	socket: SocketIOServer | null = null;
	sessionId: string = '';
	process: ChildProcessWithoutNullStreams | null = null;
	channelName: string;
	startTime?: Date;
	lastAccess?: Date;
	pool: StreamService;
	intervalHandle?: NodeJS.Timeout;

	constructor(channelName: string, pool: StreamService, sessionId: string) {
		this.channelName = channelName;
		this.pool = pool;
		this.socket = pool.socket;
		this.sessionId = sessionId;
	}

	log(text: string) {
		if (!this.logStream) {
			const logFile = path.join(CONFIG.LOGS.DIR, `${sanitizeChannelName(this.channelName)}.log`);
			this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
		}
		this.logStream.write(text);
		if (this.socket && this.sessionId) {
			this.socket.to(this.sessionId).emit('ffmpeg-log', [text]);
		}
	}

	get streamFilename() {
		return path.join(CONFIG.STREAMS.DIR, sanitizeChannelName(this.channelName), 'playlist.m3u8');
	}

	get streamDir() {
		return path.dirname(this.streamFilename);
	}

	get streamUrl() {
		return path.join(CONFIG.STREAMS.DIR_WEB, sanitizeChannelName(this.channelName), 'playlist.m3u8');
	}

	open() {
		const channel = channelService.getChannelByName(this.channelName);
		if (!(channel && channel.stream))
			throw new Error('Channel not found');

		const streamUrl = channel.stream;
		const ffmpegArgs = getFFmpegArgs(this.streamFilename, streamUrl);
		fs.mkdirSync(this.streamDir, { recursive: true });
		const ffmpeg = spawn('ffmpeg', ffmpegArgs);

		if (!ffmpeg || !ffmpeg.pid)
			throw new Error('Failed to start ffmpeg process');

		fs.writeFileSync(this.streamFilename + '.pid', ffmpeg.pid.toString());

		this.startTime = new Date();
		this.lastAccess = new Date();
		this.process = ffmpeg;

		this.log(`\n\n--------------------- STARTED ${new Date().toISOString()} ---------------------\n`)

		ffmpeg.stderr.on('data', (data) => {
			this.log(data.toString());
		});

		ffmpeg.on('exit', (code, signal) => {
			this.log(`\n\n--------------------- EXITED ${new Date().toISOString()} CODE: ${code} SIGNAL: ${signal} ---------------------\n`);
			this.logStream?.end();
			this.logStream = null;
			fs.promises.unlink(this.streamFilename).catch(err => {
				console.error('Error deleting stream file:', err);
			});
			fs.promises.unlink(this.streamFilename + '.pid').catch(err => {
				console.error('Error deleting pid file:', err);
			});
			this.process = null;
			if (this.intervalHandle) {
				clearInterval(this.intervalHandle);
				this.intervalHandle = undefined;
			}
			this.pool.endStream(this.channelName);
		});

		// check is running and pingged every STREAM_INACTIVITY_TIMEOUT / 2
		this.intervalHandle = setInterval(() => {
			if (this.process && this.process.pid && !this.process.exitCode) {
				if (!this.lastAccess || (new Date().getTime() - this.lastAccess.getTime() > CONFIG.STREAM_INACTIVITY_TIMEOUT)) {
					this.log(`\n\n--------------------- INACTIVITY TIMEOUT ${new Date().toISOString()} ---------------------\n`);
					clearInterval(this.intervalHandle);
					this.intervalHandle = undefined;
					this.close();
				}
			}
		}, CONFIG.STREAM_INACTIVITY_TIMEOUT / 2);
	}

	close() {
		if (this.process && this.process.pid && !this.process.exitCode)
			this.process.kill('SIGKILL');
	}

	ping() {
		if (this.startTime)
			this.lastAccess = new Date();
	}

	async status() {
		this.ping();

		try {
			const files = await fs.promises.readdir(this.streamDir);
			const tsFiles = files.filter(f => f.endsWith('.ts')).sort();
			const m3u8Exists = files.includes('playlist.m3u8');
			const elapsedTime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
			return { files, tsFiles, m3u8Exists, elapsedTime };
		} catch (error) {
			console.error('Error checking stream status:', (error as Error).message);
		}
		return null;
	}
}


class StreamService {
	streams: Map<string, Stream> = new Map<string, Stream>();
	maxStreams: number = CONFIG.MAX_STREAMS;
	socket: SocketIOServer | null = null;

	setSocket(socket: SocketIOServer) {
		this.socket = socket;
	}

	getStreamBySessionId(sessionId: string): Stream | null {
		for (const stream of this.streams.values()) {
			if (stream.sessionId === sessionId) {
				stream.ping();
				return stream;
			}
		}
		return null;
	}

	getStream(channelName: string, sessionId: string): Stream | null {
		let stream = this.streams.get(channelName);

		if (stream) {
			stream.ping();
			return stream;
		}

		if (this.maxStreams > 0 && this.streams.size >= this.maxStreams) {
			console.log('Max streams reached, cannot create new stream for', channelName);
			return null;
		}

		stream = new Stream(channelName, this, sessionId);
		// check if stream is closed or failed to start
		if (stream && !stream.process) {
			return null;
		}
		try {
			stream.open();
			this.streams.set(channelName, stream);
			return stream;
		} catch (error) {
			console.error('Error opening stream for', channelName, ':', (error as Error).message);
			return null;
		}
	}
	// delayed removal to allow ffmpeg exit handling and the source tunner to recycle the resource
	endStream(channelName: string) {
		setTimeout(() => {
			this.streams.delete(channelName);
		}, CONFIG.TUNER_RELEASE_TIMEOUT);
	}

	async firstRunCleanup() {
		const streamsDir = CONFIG.STREAMS.DIR;
		const dirs = await fs.promises.readdir(streamsDir, { withFileTypes: true });
		for (const dirent of dirs) {
			if (dirent.isDirectory()) {
				const dirPath = path.join(streamsDir, dirent.name);
				const pidFile = path.join(dirPath, 'playlist.m3u8.pid');
				// kill ffmpeg process if still running and remove directory
				try {
					const pidData = await fs.promises.readFile(pidFile, 'utf-8');
					const pid = parseInt(pidData, 10);
					if (!isNaN(pid)) {
						process.kill(pid, 0); // check if process is running
						process.kill(pid, 'SIGKILL'); // kill the process
						console.log(`Killed leftover ffmpeg process with PID ${pid}`);
					}
				} catch (error) {
					// process not running or pid file not found
				}
				// remove directory
				try {
					await fs.promises.rm(dirPath, { recursive: true, force: true });
					console.log(`Removed leftover stream directory: ${dirPath}`);					
				}
				catch (error) {
					console.error(`Error removing stream directory ${dirPath}:`, (error as Error).message);
				}
			}
		}	
	}
}


const streamService = new StreamService();

export { streamService };
