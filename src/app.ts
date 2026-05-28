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

console.log('🏁 Loaded app module from', __filename);

// Debug: log every incoming request path and method
app.use((req, _res, next) => {
  console.log('➡️ Incoming request:', req.method, req.originalUrl);
  next();
});

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

// Debug: inspect internal router structure
try {
	interface ExpressRouterStackEntry {
		name: string;
		route?: { path?: string };
	}

	type ExpressWithRouter = typeof app & {
		_router?: {
			stack?: ExpressRouterStackEntry[];
		};
	};

	const router = (app as unknown as ExpressWithRouter)._router;
	console.log('🔍 app._router exists:', Boolean(router));
	console.log('🔍 app._router.stack length:', router?.stack?.length ?? 'N/A');
	// show a compact view of stack entries
	const entries = router?.stack?.map((e: ExpressRouterStackEntry, i: number) => ({ i, name: e.name, route: e.route?.path })) ?? [];
	console.log('🔍 _router.stack entries sample:', entries.slice(0, 20));
} catch (err) {
	console.warn('Failed to inspect router', err);
}

// Dump some app keys to help debug Express internals (v5 differences)
try {
	const keys = Object.keys(app as unknown as Record<string, unknown>).slice(0, 50);
	console.log('🔍 app keys sample:', keys);
} catch (err) {
	console.warn('Failed to dump app keys', err);
}

// Error handling
app.use(errorHandler);

export default app;
