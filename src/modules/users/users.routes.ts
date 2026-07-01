import { Router } from 'express';
import { verifyToken, requireRole } from '../../middlewares/auth-jwt';
import { UsersController } from './users.controller';

const router = Router();

router.get('/', verifyToken, requireRole(['ADMIN']), UsersController.listUsers);
router.get('/:id', verifyToken, requireRole(['ADMIN']), UsersController.getUserById);

export default router;
