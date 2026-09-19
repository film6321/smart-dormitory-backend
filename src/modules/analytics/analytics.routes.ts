import { Router } from 'express';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { AnalyticsController } from './analytics.controller';

const router = Router();

router.get('/dashboard', verifyToken, requireRole(['ADMIN']), AnalyticsController.getDashboardAnalytics);
router.get('/observability', verifyToken, requireRole(['ADMIN']), AnalyticsController.getObservabilityAnalytics);
router.get('/metrics/raw', verifyToken, requireRole(['ADMIN']), AnalyticsController.getPrometheusMetrics);

export default router;
