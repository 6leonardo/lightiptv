import express, { Request, Response } from 'express';
import { getConfig } from '../config/index.js';
import { get } from 'http';

const router = express.Router();

router.get('/config', (_req: Request, res: Response) => {
  
  res.json({ locale: getConfig().locale });
});

export default router;
