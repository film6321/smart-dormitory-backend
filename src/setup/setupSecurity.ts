import cors from 'cors';
import express, { Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { logger } from '../logger';
import { createRateLimitStore } from '../shared/rate-limit-store';

export const setupSecurity = (app: Express) => {
  app.use(helmet());

  const configuredOrigins = [process.env.FRONTEND_URL, process.env.CORS_ORIGIN].filter(Boolean) as string[];
  const nginxHostPort = process.env.NGINX_HOST_PORT || '3002';
  const fallbackOrigins = [
    'http://localhost:3000',
    `http://localhost:${nginxHostPort}`,
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:3000',
    `http://127.0.0.1:${nginxHostPort}`,
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
  ];
  const allowedOrigins = Array.from(new Set([...configuredOrigins, ...fallbackOrigins]));

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error('Not allowed by CORS policy'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  const generalLimiter = rateLimit({
    store: createRateLimitStore('rl:general:'),
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { status: 429, message: 'Too many requests from this IP, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/', generalLimiter);

  logger.info('Security middleware initialized');
};
