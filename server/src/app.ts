import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { adminRouter } from './admin';
import { config } from './config';
import { errorHandler } from './errors';
import { serveMedia } from './media';
import { serveReceipt } from './receipt';
import { authRouter } from './routes/auth';
import { jobsRouter } from './routes/jobs';
import { mechanicRouter } from './routes/mechanic';
import { meRouter } from './routes/me';
import { vehiclesRouter } from './routes/vehicles';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind the hosting provider's TLS proxy
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.get('/', (_req, res) => {
    res.json({ name: 'MyCarRepair API', version: 'v1', docs: '/api/v1/config' });
  });
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use(meRouter);
  v1.use('/vehicles', vehiclesRouter);
  v1.use('/mechanic', mechanicRouter);
  v1.use(jobsRouter);
  v1.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
  });
  app.use('/api/v1', v1);

  app.get('/media/:key', serveMedia);
  app.get('/receipts/:id', serveReceipt);
  app.use('/admin', adminRouter);

  app.use(errorHandler);
  return app;
}
