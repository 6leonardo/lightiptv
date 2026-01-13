import express, { Request, Response } from 'express';
import { getConfig } from '../config/index.js'
import { channelService } from '../services/channels.js';

const router = express.Router();
/**
 * Get EPG data formatted for timeline grids (channels + programs).
 */
router.get('/epg', async (_req: Request, res: Response) => {
    /*
    const channels = Object.values(channelService.db.channels).map(ch => ({
        id: ch.id,
        name: ch.name,
        logo: ch.logoCachedPath ? `${config.paths.images.web}${ch.logoCachedPath}` : null
    }));
    const programs = Object.values(channelService.db.channels).flatMap(ch =>
        ch.schedules.map(program => ({
            id: `${ch.id}-${program.start.toISOString()}`,
            channelId: ch.id,
            title: program.title || 'No title',
            start: program.start,
            end: program.stop,
            desc: program.desc || null,
            category: program.category || null,
            preview: program.previewImagePath ? `${config.paths.images.web}${program.previewImagePath}` : null
        }))
    );

    */


    res.json({ programs: channelService.cache.epg });
});

export default router;
