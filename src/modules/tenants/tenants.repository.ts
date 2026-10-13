import { AppError } from '../../middlewares/error-handler';
import { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../../database/db';
import { getSettingValue } from '../settings/settings.service';

// Pending applications reserve a place until they are rejected or deactivated.
export const ROOM_RESERVATION_FILTER: Prisma.TenantWhereInput = {
  isActive: true, status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] },
};

export class TenantsRepository {
  private static readonly userSelect: Prisma.UserSelect = {
    id: true,
    username: true,
    email: true,
    role: true,
    createdAt: true,
    updatedAt: true,
  };

  static async listTenants(userId?: number, role?: string, db: DbClient = prisma) {
    const where: Prisma.TenantWhereInput = role === 'ADMIN' ? { status: { not: 'ARCHIVED' } } : { userId, status: { not: 'ARCHIVED' } };

    const tenants = await db.tenant.findMany({
      where,
      include: { user: { select: TenantsRepository.userSelect }, room: true,
        _count: { select: {
          bills: { where: { status: { not: 'PAID' } } },
          maintenanceTickets: { where: { status: { notIn: ['CLOSED', 'CANCELLED'] } } },
          visitors: { where: { status: { in: ['REGISTERED', 'VERIFYING', 'APPROVED', 'CHECKED_IN'] } } },
          housingPayments: { where: { status: { in: ['PENDING', 'VERIFYING', 'MANUAL_REVIEW'] } } },
        } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return tenants.map(tenant => ({ ...tenant,
      canDelete: ['INACTIVE', 'REJECTED'].includes(tenant.status) && tenant.roomId === null && Object.values(tenant._count).every(count => count === 0),
      deleteReason: !['INACTIVE', 'REJECTED'].includes(tenant.status) ? 'บันทึกย้ายออกหรือปฏิเสธใบสมัครก่อนลบ' : Object.values(tenant._count).some(count => count > 0) ? 'ยังมีบิล งานซ่อม การชำระเงิน หรือผู้มาติดต่อค้าง' : null,
    }));
  }

  static async getTenantById(id: number, db: DbClient = prisma) {
    return db.tenant.findUnique({
      where: { id },
      include: { user: { select: TenantsRepository.userSelect }, room: true },
    });
  }

  static async getTenantByUserId(userId: number, db: DbClient = prisma) {
    return db.tenant.findUnique({
      where: { userId },
      include: { user: { select: {
        ...TenantsRepository.userSelect,
        faceRevokedAt: true,
        _count: { select: { faceEnrollmentPhotos: true } },
        accessLogs: { where: { method: 'FACE_ENROLLMENT_COMPLETE' }, select: { path: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      } }, room: true },
    });
  }

  static async completeFaceEnrollment(userId: number, db: DbClient = prisma) {
    const run = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const tenant = await this.getTenantByUserId(userId, tx);
      if (!tenant || !tenant.isActive || !['APPROVED', 'ACTIVE'].includes(tenant.status) || tenant.roomId === null) {
        throw new AppError('ต้องเป็นผู้พักที่อนุมัติและมีห้องพักก่อนบันทึกสถานะใบหน้า', 409);
      }
      if (!tenant.user || tenant.user.faceRevokedAt || tenant.user._count.faceEnrollmentPhotos < 5) {
        throw new AppError('ยังบันทึกภาพใบหน้าไม่ครบหรือสิทธิ์ใบหน้าถูกยกเลิก', 409);
      }
      const path = `/api/tenants/${tenant.id}/face-enrollment/complete`;
      if (!await tx.accessLog.findFirst({ where: { userId, method: 'FACE_ENROLLMENT_COMPLETE', path } })) {
        await tx.accessLog.create({ data: { userId, method: 'FACE_ENROLLMENT_COMPLETE', path } });
      }
      return { faceEnrollmentComplete: true };
    };
    return typeof db.$transaction === 'function' ? (db as typeof prisma).$transaction(run) : run(db);
  }

  static async findUserById(id: number, db: DbClient = prisma) {
    return db.user.findUnique({
      where: { id },
      select: { id: true },
    });
  }

  static async findRoomById(id: number, db: DbClient = prisma) {
    return db.room.findUnique({ where: { id } });
  }

  static async createTenant(data: Prisma.TenantCreateInput | Prisma.TenantUncheckedCreateInput, db: DbClient = prisma) {
    return db.tenant.create({ data });
  }

  static async updateTenant(id: number, data: Prisma.TenantUpdateInput | Prisma.TenantUncheckedUpdateInput, db: DbClient = prisma) {
    return db.tenant.update({ where: { id }, data });
  }

  static async deleteTenant(id: number, db: DbClient = prisma) {
    const deleteRelatedRecords = async (transaction: Prisma.TransactionClient | typeof prisma) => {
      await transaction.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${id} FOR UPDATE`;
      const tenant = await transaction.tenant.findUnique({ where: { id }, include: { _count: true } });
      if (!tenant) throw new AppError('ไม่พบผู้พักที่ต้องการลบ', 404);
      if (Object.values(tenant._count).some((count) => count > 0)) {
        throw new AppError('ลบผู้พักไม่ได้ เนื่องจากมีประวัติชำระเงิน บิล ผู้มาติดต่อ หรือแจ้งซ่อมที่ต้องเก็บรักษา', 409);
      }
      if (tenant.roomId) {
        await transaction.$queryRaw`SELECT id FROM "Room" WHERE id = ${tenant.roomId} FOR UPDATE`;
        const room = await transaction.room.findUniqueOrThrow({ where: { id: tenant.roomId } });
        const maxOccupants = Number(await getSettingValue('maxOccupants')) || 4;
        const remaining = await transaction.tenant.count({ where: { ...ROOM_RESERVATION_FILTER, roomId: tenant.roomId, id: { not: id } } });
        if (remaining < Math.min(room.capacity, maxOccupants)) await transaction.room.updateMany({
          where: { id: tenant.roomId, status: 'OCCUPIED' }, data: { status: 'AVAILABLE' },
        });
      }

      return transaction.tenant.delete({ where: { id } });
    };

    if (typeof db.$transaction === 'function') {
      return (db as typeof prisma).$transaction((transaction: Prisma.TransactionClient) => deleteRelatedRecords(transaction));
    }

    return deleteRelatedRecords(db);
  }
}
