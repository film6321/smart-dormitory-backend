import { Router } from 'express';
import { verifyToken } from '../../middlewares/auth-jwt';
import NotificationPreferenceController from './notification-preferences.controller';

const router = Router();

router.get('/', verifyToken, NotificationPreferenceController.listPreferences);
router.put('/', verifyToken, NotificationPreferenceController.upsertPreference);

export default router;
