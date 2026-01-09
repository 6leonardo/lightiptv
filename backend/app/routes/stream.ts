import express, { Request, Response } from 'express';
import CONFIG from '../config/index.js';
import { streamService } from '../services/stream.js';

const router = express.Router();

/**
 * Start a new stream
 */
router.post('/start', async (req: Request, res: Response) => {
	const { streamUrl, channelName } = req.body as { streamUrl?: string; channelName?: string };
	const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
	const host = req.headers['x-forwarded-host'] || req.headers.host;
	const baseUrl = `${protocol}://${host}`;
	const sessionId = `${Math.random().toString(36).substring(2, 9)}`;
	const stream = streamService.getStream(channelName || '', sessionId);

	if (!stream) {
		console.log(`Max streams limit reached (${CONFIG.MAX_STREAMS}), rejecting new stream request`);
		return res.status(429).json({
			error: 'Max streams limit reached',
			maxStreams: CONFIG.MAX_STREAMS,
			activeStreams: streamService.streams.size
		});
	}


	const m3u8Url = new URL(stream.streamUrl, baseUrl).toString();

	return res.json({
		sessionId: stream.sessionId,
		m3u8Url,
		m3u8Path: stream.streamUrl,
		message: sessionId !== stream.sessionId ? 'Stream reused' : 'New stream started',
		reused: sessionId !== stream.sessionId
	});
});

/**
 * Get stream status
 */
router.get('/status/:sessionId', async (req: Request, res: Response) => {
	const { sessionId } = req.params;
	const stream = streamService.getStreamBySessionId(sessionId);

	if (!stream)
		return res.json({ ready: false, error: 'Stream not found', progress: 0 });

	try {
		const status = await stream.status();
		if (!status)
			return res.json({ ready: false, error: 'Error retrieving stream status', progress: 0 });

		const maxWaitTime = 20000;
		const timeProgress = Math.min((status.elapsedTime / maxWaitTime) * 100, 100);

		const hasSecondTs = status.tsFiles.length >= 3;
		const ready = hasSecondTs && status.m3u8Exists;

		const statusUrl = new URL(stream.streamUrl, `${req.protocol}://${req.get('host')}`).toString();
		res.json({
			ready,
			tsCount: status.tsFiles.length,
			m3u8Exists: status.m3u8Exists,
			progress: ready ? 100 : Math.floor(timeProgress),
			elapsedTime: Math.floor(status.elapsedTime / 1000),
			m3u8Url: statusUrl,
			m3u8Path: stream.streamUrl,
			ffmpegCommand: "ffmpeg",
			ffmpegOutput: ""
		});
	} catch (error) {
		res.json({ ready: false, error: 'Error checking stream status', progress: 0 });
	}
});

/**
 * Stop stream
 */
router.post('/stop/:sessionId', async (req: Request, res: Response) => {
	const { sessionId } = req.params;

	const stream = streamService.getStreamBySessionId(sessionId);
	if (stream)
		stream.close();

	res.json({ message: 'Stream stopped' });
});

/**
 * Stream heartbeat
 */
router.post('/heartbeat/:sessionId', (req: Request, res: Response) => {
	const { sessionId } = req.params;
	const stream = streamService.getStreamBySessionId(sessionId);
	if (stream) {
		stream.ping();
		res.json({ status: 'ok' });
	} else {
		res.status(404).json({ error: 'Stream not found' });
	}
});

export default router;
