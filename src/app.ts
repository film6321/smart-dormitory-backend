import dotenv from 'dotenv';
import path from 'path';
import express from 'express';

// Load environment variables early
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Setup pattern imports
import { setupMonitoring } from './setup/setupMonitoring';
import { setupSecurity } from './setup/setupSecurity';
import { setupSwagger } from './setup/setupSwagger';

// Route imports
import { accessLog } from './middlewares/accessLog';
import { errorHandler } from './middlewares/error-handler';
import authRoutes from './modules/auth/auth.routes';
import ocrRoutes from './modules/ocr/ocr.routes';
import healthRoutes from './routes/health';

const app = express();

// Initialize system components
setupSecurity(app);
setupMonitoring(app);
setupSwagger(app);

// API routes
app.use(accessLog);
app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/ocr', ocrRoutes);

// Temporary health check for /api prefix
app.get('/api/ping', (_req, res) => res.status(200).send('pong'));

// Error handling
app.use(errorHandler);

export default app;
