import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { Server as SocketIOServer } from 'socket.io';
import { channelService } from './channels.js';
import CONFIG from '../config/index.js';
import getFFmpegArgs from './ffmpeg-profile.js';
import { resolveStreamUrl } from './detect.js';
import { Mutex } from 'async-mutex';
//import getFFmpegArgs from './ffmpeg-detect.js';

function sanitizeChannelName(channelName: string): string {
	return channelName.replace(/[^a-zA-Z0-9-_]/g, '_');
}

class Stream {
	logStream: fs.WriteStream | null = null;
	socket: SocketIOServer | null = null;
	sessionId: string = '';
	ffmpegProcess: ChildProcess | null = null;
	streamlinkProcess: ChildProcess | null = null;
	channelName: string;
	startTime?: Date;
	lastAccess?: Date;
	pool: StreamService;
	intervalHandle?: NodeJS.Timeout;
	killed: boolean = false;

	constructor(channelName: string, pool: StreamService, sessionId: string) {
		this.channelName = channelName;
		this.pool = pool;
		this.socket = pool.socket;
		this.sessionId = sessionId;
	}

	log(source: 'server' | 'ffmpeg' | 'streamlink', text: string) {
		// a spazi fissi
		const line = `[${source}]\t${new Date().toISOString()}\t${text.replace(/\r?\n/gm, '\t\t')}`.replace(/\t\t$/, '');
		if (!this.logStream) {
			const logFile = path.join(CONFIG.LOGS.DIR, `${sanitizeChannelName(this.channelName)}.log`);
			this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
		}

		this.logStream.write(line + '\n');
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

	async open() {
		const channel = channelService.getChannelByName(this.channelName);
		if (!(channel && channel.stream))
			throw new Error('Channel not found');

		fs.mkdirSync(this.streamDir, { recursive: true });
		const streamUrl = await resolveStreamUrl(channel.stream);
		const ffmpegArgs = getFFmpegArgs(this.streamFilename, "pipe:0")   //getFFmpegArgs(this.streamFilename, streamUrl);
		this.streamlinkProcess = spawn('streamlink', [streamUrl, 'best', '-O'], { stdio: ['ignore', 'pipe', 'pipe'] });
		this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

		this.streamlinkProcess.stdout!.pipe(this.ffmpegProcess.stdin!);
		//const ffmpeg = spawn('ffmpeg', ffmpegArgs);

		if (!this.ffmpegProcess.pid || !this.streamlinkProcess.pid)
			throw new Error('Failed to start ffmpeg process');

		fs.writeFileSync(this.streamFilename + '.pid', `${this.ffmpegProcess.pid.toString()}\n${this.streamlinkProcess.pid.toString()}\n`);

		this.startTime = new Date();
		this.lastAccess = new Date();

		this.log('server', `--------------------- STARTED ${new Date().toISOString()} ---------------------`)

		this.streamlinkProcess.stderr?.on('data', (data) => {
			this.log('streamlink', data.toString());
		});

		this.streamlinkProcess.on('exit', (code, signal) => {
			this.kill({ code, signal });
		});

		this.ffmpegProcess.stdout?.on('data', (data) => {
			this.log('ffmpeg', data.toString());
		});

		this.ffmpegProcess.stderr?.on('data', (data) => {
			this.log('ffmpeg', data.toString());
		});

		this.ffmpegProcess.on('exit', (code, signal) => {
			this.kill({ code, signal });
		});

		// check is running and pingged every STREAM_INACTIVITY_TIMEOUT / 2
		this.intervalHandle = setInterval(() => {
			if (!this.lastAccess || (new Date().getTime() - this.lastAccess.getTime() > CONFIG.STREAM_INACTIVITY_TIMEOUT)) {
				this.log('server', `--------------------- INACTIVITY TIMEOUT ${new Date().toISOString()} ---------------------`);
				this.kill({ why: 'inactivity timeout' });
			}
		}, CONFIG.STREAM_INACTIVITY_TIMEOUT / 2);
	}


	private kill({ code, signal, why }: { code?: number | null; signal?: NodeJS.Signals | null; why?: string }) {
		if (this.killed)
			return;
		this.killed = true;
		console.log(`Killing stream for channel ${this.channelName} ${why ? `(${why})` : ''}`);
		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = undefined;
		}
		if (this.ffmpegProcess && this.ffmpegProcess.exitCode === null && this.ffmpegProcess.pid)
			this.ffmpegProcess.kill('SIGKILL');

		if (this.streamlinkProcess && this.streamlinkProcess.exitCode === null && this.streamlinkProcess.pid)
			this.streamlinkProcess.kill('SIGKILL');

		this.pool.endStream(this.channelName);
		this.log('server', `--------------------- EXITED ${new Date().toISOString()} ${why ? `WHY: ${why}` : `CODE: ${code} SIGNAL: ${signal}`} ---------------------`);
		this.logStream?.end();
		this.logStream = null;
		fs.promises.rm(this.streamDir, { recursive: true, force: true }).catch(err => {
			console.error('Error removing stream directory:', err);
		});

	}

	close() {
		this.kill({ why: 'closed by user' });
	}

	ping() {
		if (this.startTime)
			this.lastAccess = new Date();
	}

	async status() {
		this.ping();

		try {
			const files = await fs.promises.readdir(this.streamDir);
			const tsFiles = files.filter(f => !/m3u8(\.pid)?$/.test(f)).sort();
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
	mutex = new Mutex();

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

	async getStream(channelName: string, sessionId: string): Promise<Stream | null> {
		let stream = this.streams.get(channelName);

		if (stream) {
			stream.ping();
			return stream;
		}

		if (this.maxStreams > 0 && this.streams.size >= this.maxStreams) {
			console.log('Max streams reached, cannot create new stream for', channelName);
			return null;
		}

		const release = await this.mutex.acquire();
		stream = new Stream(channelName, this, sessionId);
		try {
			await stream.open();
			this.streams.set(channelName, stream);
			release();
			return stream;
		} catch (error) {
			release();
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
				const pidData = await fs.promises.readFile(pidFile, 'utf-8');
				const pids = pidData.split('\n').map(line => parseInt(line, 10));
				for (const pid of pids)
					try {
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
