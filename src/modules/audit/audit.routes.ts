import { Router } from 'express';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { AuditController } from './audit.controller';

const router = Router();

router.get('/', verifyToken, requireRole(['ADMIN']), AuditController.list);

export default router;
