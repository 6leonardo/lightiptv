import express from 'express';
import fs from 'fs';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { getConfig } from './config/index.js';
import { channelService } from './services/channels.js';
import { streamService } from './services/stream.js';
import { initDirs } from './services/dirs.js';
import channelsRouter from './routes/channels.js';
import epgRouter from './routes/epg.js';
import configRouter from './routes/config.js';
import streamRouter from './routes/stream.js';
import URL from 'url';
import { Mutex } from 'async-mutex';

const __dirname = path.dirname(URL.fileURLToPath(import.meta.url));
const config = getConfig();

initDirs();
streamService.firstRunCleanup().then(() => {
	console.log('First run cleanup completed');
}).catch((err) => {
	console.error('Error during first run cleanup:', err);
})
channelService.init();
await channelService.updateChannels();
console.log('Channels initialized');

const app = express();
const hasFrontend = fs.existsSync(config.paths.frontend);

app.use(express.json());

// CORS solo se non c'è il frontend (dev mode con Vite separato)
if (!hasFrontend) {
	app.use((_req, res, next) => {
		res.header('Access-Control-Allow-Origin', '*');
		res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
		res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
		if (_req.method === 'OPTIONS') {
			return res.sendStatus(204);
		}
		next();
	});
}

// Serve public assets (images, cached files, etc.)
app.use('/cached', express.static(config.paths.cached));
const imageMutex = new Mutex();
// Serve images with caching
app.use(config.paths.images.web, async (req, res, next) => {
	const image = req.path.replace(config.paths.images.web, '');
	//mutex lock on path
	await imageMutex.runExclusive(async () => {
		if(await channelService.cacheProgramPreview(image)) {
			console.log(`Cached image downloaded: ${image}`);
			res.sendFile(path.join(config.paths.images.dir, image));
		} else {
			res.sendStatus(404);
		}
	});
});


// API routes
app.use('/api', channelsRouter);
app.use('/api', epgRouter);
app.use('/api', configRouter);
app.use('/api/stream', streamRouter);

// Serve frontend in production
if (hasFrontend) {
	app.use(express.static(config.paths.frontend));
	app.get('*', (_req, res) => {
		res.sendFile(path.join(config.paths.frontend, 'index.html'));
	});
}


const server = http.createServer(app);
const io = new SocketIOServer(server);
streamService.setSocket(io);
channelService.setSocket(io);

io.on('connection', (socket) => {
	console.log('Client connected');

	socket.on('join-stream', (channelName: string) => {
		if (socket.rooms.has(channelName)) {
			return;
		}
		socket.join(channelName);
		console.log(`Client joined stream room: ${channelName}`);
	});

	socket.on('leave-stream', (channelName: string) => {
		socket.leave(channelName);
		console.log(`Client left stream room: ${channelName}`);
	});

	socket.on('stream-heartbeat', (channelName: string) => {
		console.log(`Received heartbeat for stream: ${channelName}`);
		streamService.ping(channelName);
	});

	socket.on('stream-close', (channelName: string) => {
		streamService.stop(channelName);
	});

});


async function start() {
	console.log(`Server running on http://${config.address}:${config.port}`);
	console.log(`M3Us URL: \n${Object.keys(config.m3u.sources).map(key => `\t${key}: ${config.m3u.sources[key].url}`).join('\n')}\n\n`);
	console.log(`XMLTVs URL: \n${Object.keys(config.xmltv.sources).map(key => `\t${key}: ${config.xmltv.sources[key].url}`).join('\n')}\n\n`);
	console.log(`Max streams: ${config.maxStreams === 0 ? 'unlimited' : config.maxStreams}`);
}

server.listen(config.port, config.address, () => {
	start();
});

export default app;
