import express, { Request, Response } from 'express';
import { getConfig } from '../config/index.js'
import { channelService } from '../services/channels.js';

const router = express.Router();
/**
 * Get EPG data formatted for timeline grids (channels + programs).
 */
router.get('/epg', async (_req: Request, res: Response) => {
    res.json({ programs: channelService.getPrograms()  });
});

export default router;
