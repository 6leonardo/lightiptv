import express, { Request, Response } from 'express';
import { channelService } from '../services/channels.js';

const router = express.Router();

/**
 * Get EPG data
 */
router.get('/epg', async (_req: Request, res: Response) => {
    res.json(channelService.db.programsCache);
});

export default router;
