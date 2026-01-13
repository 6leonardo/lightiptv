import express, { Request, Response } from 'express';
import { getConfig } from '../config/index.js';
import { streamService } from '../services/stream.js';

const router = express.Router();

/**
 * Start a new stream
 */
router.post('/start', async (req: Request, res: Response) => {
	const { channelName } = req.body as { channelName?: string };
	if (!channelName) {
		return res.status(400).json({ error: 'channelName is required' });
	}
	/*
	const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
	const host = req.headers['x-forwarded-host'] || req.headers.host;
	const baseUrl = `${protocol}://${host}`;
	*/
	const stream = await streamService.createStream(channelName);

	if (!stream) {
		console.log(`Max streams limit reached (${getConfig().maxStreams}), rejecting new stream request`);
		res.status(429).json({
			error: 'Max streams limit reached',
			maxStreams: getConfig().maxStreams,
			activeStreams: streamService.streams.size
		});
		return
	}

	//const m3u8Url = new URL(stream.streamUrl, baseUrl).toString();

	return res.json({
		//m3u8Url,
		m3u8Path: stream.streamUrl,
	});
});


export default router;
