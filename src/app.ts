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
import faceVerificationRoutes from './modules/face-verification/face-verification.routes';
import usersRoutes from './modules/users/users.routes';
import tenantsRoutes from './modules/tenants/tenants.routes';
import roomsRoutes from './modules/rooms/rooms.routes';
import billingRoutes from './modules/billing/billing.routes';
import paymentBatchRoutes from './modules/billing/payment-batch.routes';
import maintenanceRoutes from './modules/maintenance/maintenance.routes';
import visitorRoutes from './modules/visitor/visitor.routes';
import notificationRoutes from './modules/notifications/notification.routes';
import notificationPreferencesRoutes from './modules/notifications/notification-preferences.routes';
import healthRoutes from './routes/health';
import auditRoutes from './modules/audit/audit.routes';
import settingsRoutes from './modules/settings/settings.routes';
import analyticsRoutes from './modules/analytics/analytics.routes';

const app = express();

// Trust the first proxy hop (Nginx) so req.ip reflects the real client IP
// from the X-Forwarded-For header — required for accurate Rate Limiting in replicated setup
app.set('trust proxy', 1);

// Serve static files from public folder (e.g., live camera feed)
app.use(express.static(path.join(process.cwd(), 'public')));

// Initialize system components
setupSecurity(app);
setupMonitoring(app);
setupSwagger(app);

// API routes
app.use(accessLog);
app.use('/health', healthRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/ocr', ocrRoutes);
app.use('/api/face-verification', faceVerificationRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/tenants', tenantsRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/payment-batches', paymentBatchRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/visitor', visitorRoutes);
app.use('/visitor', visitorRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/notifications/preferences', notificationPreferencesRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/analytics', analyticsRoutes);

// Temporary health check for /api prefix
app.get('/api/ping', (_req, res) => res.status(200).send('pong'));

// Error handling
app.use(errorHandler);

export default app;
