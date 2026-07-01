import { Router } from 'express';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { validateDto } from '../shared/dto-validation';
import { MaintenanceController } from './maintenance.controller';
import { createMaintenanceTicketSchema, updateMaintenanceStatusSchema } from './maintenance.dto';

const router = Router();

router.post('/', verifyToken, validateDto(createMaintenanceTicketSchema), MaintenanceController.createTicket);
router.get('/', verifyToken, MaintenanceController.listTickets);
router.patch('/:id/status', verifyToken, requireRole(['ADMIN']), validateDto(updateMaintenanceStatusSchema), MaintenanceController.updateTicketStatus);

export default router;
