import { Router } from 'express';
import { verifyToken, requireRole } from '../../middlewares/auth-jwt';
import { UsersController } from './users.controller';

const router = Router();

router.get('/me/privacy-consent/:purpose', verifyToken, requireRole(['STUDENT']), UsersController.getPrivacyConsent);
router.post('/me/privacy-consent', verifyToken, requireRole(['STUDENT']), UsersController.acceptPrivacyConsent);

router.get('/', verifyToken, requireRole(['ADMIN']), UsersController.listUsers);
router.get('/:id', verifyToken, requireRole(['ADMIN']), UsersController.getUserById);
router.post('/', verifyToken, requireRole(['ADMIN']), UsersController.createUser);
router.patch('/:id', verifyToken, requireRole(['ADMIN']), UsersController.updateUser);
router.delete('/:id', verifyToken, requireRole(['ADMIN']), UsersController.deleteUser);

export default router;
