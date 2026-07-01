import { Router } from 'express';
import { verifyToken, requireRole } from '../../middlewares/auth-jwt';
import { validateDto } from '../shared/dto-validation';
import { VisitorController } from './visitor.controller';
import { registerVisitorSchema, updateVisitorStatusSchema } from './visitor.dto';

const router = Router();

router.post('/register', verifyToken, validateDto(registerVisitorSchema), VisitorController.registerVisitor);
router.get('/', verifyToken, requireRole(['ADMIN']), VisitorController.listVisitors);
router.patch('/:id/status', verifyToken, requireRole(['ADMIN']), validateDto(updateVisitorStatusSchema), VisitorController.updateVisitorStatus);

export default router;
