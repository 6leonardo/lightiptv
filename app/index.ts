import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import CONFIG from './config/index.js';
import { channelService } from './services/channels.js';
import { streamService } from './services/stream.js';
import { initDirs } from './services/dirs.js';
import channelsRouter from './routes/channels.js';
import epgRouter from './routes/epg.js';
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


app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use('/api', channelsRouter);
app.use('/api', epgRouter);
app.use('/api/stream', streamRouter);

const server = http.createServer(app);
const io = new SocketIOServer(server);
streamService.setSocket(io);
channelService.setSocket(io);

io.on('connection', (socket) => {
	console.log('Client connected');

	socket.on('join-stream', (sessionId: string) => {
		socket.join(sessionId);
		console.log(`Client joined stream room: ${sessionId}`);
	});

	socket.on('leave-stream', (sessionId: string) => {
		socket.leave(sessionId);
		console.log(`Client left stream room: ${sessionId}`);
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
