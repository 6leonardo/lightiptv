import express, { Request, Response } from 'express';
import { channelService } from '../services/channels.js';

const router = express.Router();

/**
 * Get channels with streaming status
 */
router.get('/channels', async (_req: Request, res: Response) => {
    res.json({ channels: channelService.channels });
});


export default router;
