import { Router } from 'express';
import { verifyToken, requireRole } from '../../middlewares/auth-jwt';
import { validateDto } from '../../middlewares/dto-validation';
import NotificationController from './notification.controller';
import { createNotificationSchema } from './notification.dto';

const router = Router();

router.get('/', verifyToken, requireRole(['ADMIN', 'STUDENT']), NotificationController.listNotifications);
router.get('/dead-letters', verifyToken, requireRole(['ADMIN']), NotificationController.listDeadLetters);
router.get('/audit-logs', verifyToken, requireRole(['ADMIN']), NotificationController.listAuditLogs);
router.post('/dead-letters/:id/retry', verifyToken, requireRole(['ADMIN']), NotificationController.retryDeadLetter);
router.delete('/dead-letters/:id', verifyToken, requireRole(['ADMIN']), NotificationController.deleteDeadLetter);
router.post('/', verifyToken, requireRole(['ADMIN']), validateDto(createNotificationSchema), NotificationController.createNotification);
router.post('/:id/send', verifyToken, requireRole(['ADMIN']), NotificationController.sendNotification);
router.post('/webhook/provider', NotificationController.handleProviderWebhook);

export default router;
