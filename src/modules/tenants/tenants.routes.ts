import { Router } from 'express';
import { requireRole, verifyToken } from '../../middlewares/auth-jwt';
import { TenantsController } from './tenants.controller';

const router = Router();

router.get('/', verifyToken, requireRole(['ADMIN']), TenantsController.listTenants);
router.get('/:id', verifyToken, requireRole(['ADMIN']), TenantsController.getTenantById);
router.post('/', verifyToken, requireRole(['ADMIN']), TenantsController.createTenant);
router.patch('/:id', verifyToken, requireRole(['ADMIN']), TenantsController.updateTenant);
router.delete('/:id', verifyToken, requireRole(['ADMIN']), TenantsController.deleteTenant);

export default router;
