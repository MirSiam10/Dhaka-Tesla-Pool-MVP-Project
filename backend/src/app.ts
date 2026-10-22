import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import { healthRouter } from './routes/health';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind Render/Nginx/Next.js the real client IP arrives in X-Forwarded-For (rate limiting).
  app.set('trust proxy', 1);

  app.use(helmet());
  if (config.CORS_ORIGIN) app.use(cors({ origin: config.CORS_ORIGIN.split(',') }));
  app.use(express.json({ limit: '10kb' }));
  app.use(
    pinoHttp({
      logger,
      // Health checks every few seconds would drown real traffic.
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    }),
  );

  app.use('/health', healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
