import { Router } from 'express';
import { verifyToken } from '../../middlewares/auth-jwt';
import { validateDto } from '../shared/dto-validation';
import NotificationController from './notification.controller';
import { createNotificationSchema } from './notification.dto';

const router = Router();

router.get('/', verifyToken, NotificationController.listNotifications);
router.get('/dead-letters', verifyToken, NotificationController.listDeadLetters);
router.get('/audit-logs', verifyToken, NotificationController.listAuditLogs);
router.post('/dead-letters/:id/retry', verifyToken, NotificationController.retryDeadLetter);
router.delete('/dead-letters/:id', verifyToken, NotificationController.deleteDeadLetter);
router.post('/', verifyToken, validateDto(createNotificationSchema), NotificationController.createNotification);
router.post('/:id/send', verifyToken, NotificationController.sendNotification);
router.post('/webhook/provider', NotificationController.handleProviderWebhook);

export default router;
