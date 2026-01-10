import express, { Request, Response } from 'express';
import CONFIG from '../config/index.js';

const router = express.Router();

router.get('/config', (_req: Request, res: Response) => {
  res.json({ locale: CONFIG.LOCALE });
});

export default router;
