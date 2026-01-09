import express, { Request, Response } from 'express';
import CONFIG from '../config/index.js';
import { channelService } from '../services/channels.js';

const router = express.Router();

/**
 * Get EPG data formatted for timeline grids (channels + programs).
 */
router.get('/epg-grid', async (_req: Request, res: Response) => {
    const channels = Object.values(channelService.db.channels).map(ch => ({
        id: ch.tvgId,
        name: ch.name,
        logo: ch.logoCachedPath ? `${CONFIG.IMAGES.DIR_WEB}${ch.logoCachedPath}` : null
    }));

    const programs = Object.values(channelService.db.channels).flatMap(ch =>
        ch.schedules.map(program => ({
            id: `${ch.tvgId}-${program.start.toISOString()}`,
            channelId: ch.tvgId,
            title: program.title || 'No title',
            start: program.start,
            end: program.stop,
            desc: program.desc || null,
            category: program.category || null,
            preview: program.previewImagePath ? `${CONFIG.IMAGES.DIR_WEB}${program.previewImagePath}` : null
        }))
    );

    res.json({ channels, programs });
});

export default router;
