import { Router } from 'express';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { RoomsController } from './rooms.controller';

const router = Router();

router.get('/', verifyToken, requireRole(['ADMIN']), RoomsController.listRooms);
router.get('/:id', verifyToken, requireRole(['ADMIN']), RoomsController.getRoomById);
router.post('/', verifyToken, requireRole(['ADMIN']), RoomsController.createRoom);
router.patch('/:id', verifyToken, requireRole(['ADMIN']), RoomsController.updateRoom);
router.delete('/:id', verifyToken, requireRole(['ADMIN']), RoomsController.deleteRoom);

export default router;
