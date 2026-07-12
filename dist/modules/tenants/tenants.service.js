"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsService = void 0;
const db_1 = require("../../database/db");
const error_handler_1 = require("../../middlewares/error-handler");
class TenantsService {
    static async listTenants(prismaClient = db_1.prisma) {
        return prismaClient.tenant.findMany({
            include: { user: true, room: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    static async getTenantById(id, prismaClient = db_1.prisma) {
        return prismaClient.tenant.findUnique({
            where: { id },
            include: { user: true, room: true },
        });
    }
    static async createTenant(data, prismaClient = db_1.prisma) {
        if (data.userId !== undefined && data.userId !== null) {
            const user = await prismaClient.user.findUnique({ where: { id: data.userId } });
            if (!user) {
                throw new error_handler_1.AppError('User not found', 404);
            }
        }
        if (data.roomId !== undefined && data.roomId !== null) {
            const room = await prismaClient.room.findUnique({ where: { id: data.roomId } });
            if (!room) {
                throw new error_handler_1.AppError('Room not found', 404);
            }
        }
        return prismaClient.tenant.create({
            data: {
                userId: data.userId ?? null,
                roomId: data.roomId ?? null,
                fullName: data.fullName?.trim(),
                phone: data.phone?.trim(),
                emergencyContact: data.emergencyContact?.trim(),
                checkInDate: data.checkInDate ? new Date(data.checkInDate) : null,
                checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : null,
                isActive: data.isActive ?? true,
            },
        });
    }
    static async updateTenant(id, data, prismaClient = db_1.prisma) {
        return prismaClient.tenant.update({
            where: { id },
            data: {
                userId: data.userId ?? undefined,
                roomId: data.roomId ?? undefined,
                fullName: data.fullName?.trim(),
                phone: data.phone?.trim(),
                emergencyContact: data.emergencyContact?.trim(),
                checkInDate: data.checkInDate ? new Date(data.checkInDate) : undefined,
                checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : undefined,
                isActive: data.isActive,
            },
        });
    }
    static async deleteTenant(id, prismaClient = db_1.prisma) {
        return prismaClient.tenant.delete({ where: { id } });
    }
}
exports.TenantsService = TenantsService;
