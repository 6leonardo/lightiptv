import fs from 'fs';
import path, { parse } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { Server as SocketIOServer } from 'socket.io';
import { channelService, ChannelRecord } from './channels.js';
import { getConfig } from '../config/index.js';
import getFFmpegArgs from './ffmpeg-profile.js';
import { resolveStreamUrl } from './detect.js';
import { Mutex } from 'async-mutex';
//import getFFmpegArgs from './ffmpeg-detect.js';

const config = getConfig();

function sanitizeChannelName(channelName: string): string {
	return channelName.replace(/[^a-zA-Z0-9-_]/g, '_');
}

class Stream {
	logStream: fs.WriteStream | null = null;
	socket: SocketIOServer | null = null;
	ffmpegProcess: ChildProcess | null = null;
	streamlinkProcess: ChildProcess | null = null;
	channelName: string;
	count: number = 0;
	startTime?: Date;
	lastAccess?: Date;
	pool: StreamService;
	liveIntervalHandle?: NodeJS.Timeout;
	killed: boolean = false;

	constructor(channelName: string, pool: StreamService) {
		this.channelName = channelName;
		this.pool = pool;
		this.socket = pool.socket;
	}

	log(source: 'server' | 'ffmpeg' | 'streamlink', text: string) {
		// a spazi fissi
		const line = `[${source}]\t${new Date().toISOString()}\t${text.replace(/\r?\n/gm, '\t\t')}`.replace(/\t\t$/, '');
		if (!this.logStream) {
			const logFile = path.join(config.paths.logs.dir, `${sanitizeChannelName(this.channelName)}.log`);
			this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
		}

		this.logStream.write(line + '\n');
		if (this.socket && this.channelName) {
			this.socket.to(this.channelName).emit('ffmpeg-log', [text]);
		}
	}

	get streamFilename() {
		return path.join(config.paths.streams.dir, sanitizeChannelName(this.channelName), 'playlist.m3u8');
	}

	get streamDir() {
		return path.dirname(this.streamFilename);
	}

	get streamUrl() {
		return path.join(config.paths.streams.web, sanitizeChannelName(this.channelName), 'playlist.m3u8');
	}


	private rankChannels(channels: ChannelRecord[]): { channel: ChannelRecord; score: number }[] {
		const list: { channel: ChannelRecord; score: number }[] = channels.map(c => ({ channel: c, score: parseInt(c.extra?.ranking) || 0 }));
		list.sort((a, b) => b.score - a.score);
		return list;
	}


	async open() {
		// TODO: Choose best stream URL based on quality, region, etc.
		const channels = channelService.getChannelByName(this.channelName);
		if (!(channels.length > 0 && channels[0].stream))
			throw new Error('Channel not found');

		fs.mkdirSync(this.streamDir, { recursive: true });
		const rankedChannels = this.rankChannels(channels);
		for (const rc of rankedChannels) {
			this.log('server', `Channel option: ${rc.channel.stream} (score: ${rc.score})`);
			const channel = rc.channel;
			const streamUrl = await resolveStreamUrl(channel.stream);
			const ffmpegArgs = getFFmpegArgs(this.streamFilename, "pipe:0")   //getFFmpegArgs(this.streamFilename, streamUrl);
			this.streamlinkProcess = spawn('streamlink', [
				`--http-header=User-Agent=${config.streamlink.userAgent}`,
				streamUrl,
				'best,720,480,360',
				'-O'], { stdio: ['ignore', 'pipe', 'pipe'] });
			this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

			this.streamlinkProcess.stdout!.pipe(this.ffmpegProcess.stdin!);
			//const ffmpeg = spawn('ffmpeg', ffmpegArgs);

			await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
			if (this.ffmpegProcess.exitCode !== null && this.streamlinkProcess.exitCode !== null) {
				if (this.ffmpegProcess.exitCode === null)
					this.ffmpegProcess.kill('SIGKILL');
				if (this.streamlinkProcess.exitCode === null)
					this.streamlinkProcess.kill('SIGKILL');
				this.log('server', `Failed to start stream for URL: ${streamUrl}. Trying next option if available.`);
				continue;
			}
			break;
		}
		if (this.ffmpegProcess === null || this.streamlinkProcess === null)
			throw new Error('Failed to start stream for all available URLs.');

		if (this.ffmpegProcess.pid && this.streamlinkProcess.pid) {
			fs.writeFileSync(this.streamFilename + '.pid', `${this.ffmpegProcess.pid.toString()}\n${this.streamlinkProcess.pid.toString()}\n`);
		}

		this.startTime = new Date();
		this.lastAccess = new Date();

		this.log('server', `--------------------- STARTED ${new Date().toISOString()} ---------------------`)
		this.count += 1;
		this.streamlinkProcess.stderr?.on('data', (data) => {
			this.log('streamlink', data.toString());
		});

		this.streamlinkProcess.on('exit', (code, signal) => {
			this.kill({ prg: 'streamlink', code, signal });
		});

		this.ffmpegProcess.stdout?.on('data', (data) => {
			this.log('ffmpeg', data.toString());
		});

		this.ffmpegProcess.stderr?.on('data', (data) => {
			this.log('ffmpeg', data.toString());
		});

		this.ffmpegProcess.on('exit', (code, signal) => {
			this.kill({ prg: 'ffmpeg', code, signal });
		});

		// check is running and pingged every STREAM_INACTIVITY_TIMEOUT / 2
		this.liveIntervalHandle = setInterval(() => {
			if (this.killed || !this.lastAccess || (new Date().getTime() - this.lastAccess.getTime() > config.streamInactivityTimeout)) {
				this.log('server', `--------------------- INACTIVITY TIMEOUT ${new Date().toISOString()} ---------------------`);
				this.kill({ why: 'inactivity timeout' });
			}
			this.status();
		}, config.streamInactivityTimeout / 5);
	}


	private kill({ prg, code, signal, why }: { prg?: string; code?: number | null; signal?: NodeJS.Signals | null; why?: string }) {
		if (this.killed)
			return;
		this.killed = true;
		console.log(`Killing stream for channel ${this.channelName} ${why ? `(${why})` : `PRG: ${prg} CODE: ${code} SIGNAL: ${signal}`}`);
		if (this.socket && this.channelName) {
			this.socket.to(this.channelName).emit('stream-killed', {
				channelName: this.channelName,
				why: why || `Program ${prg} exited with code ${code} signal ${signal}`,
			});
		}
		if (this.liveIntervalHandle) {
			clearInterval(this.liveIntervalHandle);
			this.liveIntervalHandle = undefined;
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
		this.count--;
		if (this.count <= 0)
			this.kill({ why: 'closed by user' });
	}

	ping() {
		if (this.startTime)
			this.lastAccess = new Date();
	}

	private async status() {
		//this.ping();

		try {
			const files = await fs.promises.readdir(this.streamDir);
			const tsFiles = files.filter(f => !/m3u8(\.pid)?$/.test(f)).sort();
			const m3u8Exists = files.includes('playlist.m3u8');
			const elapsedTime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
			if (this.socket && this.channelName) {
				const ready = tsFiles.length >= 3 && m3u8Exists;
				const maxWaitTime = 40000;
				const timeProgress = Math.min((elapsedTime / maxWaitTime) * 100, 100);
				this.socket.to(this.channelName).emit('stream-status', {
					channelName: this.channelName,
					ready,
					tsCount: tsFiles.length,
					m3u8Exists,
					progress: ready ? 100 : Math.floor(timeProgress),
					elapsedTime: Math.floor(elapsedTime / 1000),
					m3u8Url: this.streamUrl,
				});
			}
			// return { files, tsFiles, m3u8Exists, elapsedTime };
		} catch (error) {
			console.error('Error checking stream status:', (error as Error).message);
		}
		return null;
	}
}


class StreamService {
	streams: Map<string, Stream> = new Map<string, Stream>();
	maxStreams: number = config.maxStreams;
	socket: SocketIOServer | null = null;
	mutex = new Mutex();

	setSocket(socket: SocketIOServer) {
		this.socket = socket;
	}

	getStream(channelName: string): Stream | null {
		return this.streams.get(channelName) || null;
	}

	async createStream(channelName: string): Promise<Stream | null> {
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
		stream = new Stream(channelName, this);
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
		}, config.tunerReleaseTimeout);
	}

	ping(channelName: string) {
		const stream = this.streams.get(channelName);
		if (stream) {
			stream.ping();
			return true;
		}
		return false;
	}

	stop(channelName: string) {
		const stream = this.streams.get(channelName);
		if (stream) {
			stream.close();
		}
	}

	async firstRunCleanup() {
		const streamsDir = config.paths.streams.dir;
		if (!fs.existsSync(streamsDir)) {
			return;
		}
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
