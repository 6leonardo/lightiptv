import express from 'express';
import fs from 'fs';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import CONFIG from './config/index.js';
import { channelService } from './services/channels.js';
import { streamService } from './services/stream.js';
import { initDirs } from './services/dirs.js';
import channelsRouter from './routes/channels.js';
import epgRouter from './routes/epg.js';
import epgGridRouter from './routes/epg-grid.js';
import configRouter from './routes/config.js';
import streamRouter from './routes/stream.js';
import URL from 'url';

const __dirname = path.dirname(URL.fileURLToPath(import.meta.url));


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
const frontendDist = path.join(__dirname, 'public', 'dist');
const publicDir = path.join(__dirname, 'public');
const hasFrontend = fs.existsSync(frontendDist);

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
app.use('/cached', express.static(path.join(publicDir, 'cached')));
app.use('/images', express.static(path.join(publicDir, 'images')));

// API routes
app.use('/api', channelsRouter);
app.use('/api', epgRouter);
app.use('/api', epgGridRouter);
app.use('/api', configRouter);
app.use('/api/stream', streamRouter);

// Serve frontend in production
if (hasFrontend) {
	app.use(express.static(frontendDist));
	app.get('*', (_req, res) => {
		res.sendFile(path.join(frontendDist, 'index.html'));
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
	console.log(`Server running on http://localhost:${CONFIG.PORT}`);
	console.log(`Threadfin M3U URL: ${CONFIG.THREADFIN_M3U_URL}`);
	console.log(`Threadfin XMLTV URL: ${CONFIG.THREADFIN_XMLTV_URL}`);
	console.log(`Max streams: ${CONFIG.MAX_STREAMS === 0 ? 'unlimited' : CONFIG.MAX_STREAMS}`);
}

server.listen(CONFIG.PORT, start);

export default app;
