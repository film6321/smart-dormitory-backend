import { Router } from 'express';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { SettingsController } from './settings.controller';

const router = Router();
router.get('/academics', verifyToken, SettingsController.academics);
router.post('/academics', verifyToken, requireRole(['ADMIN']), SettingsController.changeAcademic);

router.get('/', verifyToken, requireRole(['ADMIN']), SettingsController.get);
router.patch('/', verifyToken, requireRole(['ADMIN']), SettingsController.update);

export default router;
