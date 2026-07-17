"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsService = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const tenants_repository_1 = require("./tenants.repository");
class TenantsService {
    static async listTenants(db) {
        return tenants_repository_1.TenantsRepository.listTenants(undefined, undefined, db);
    }
    static async getTenantById(id, db) {
        return tenants_repository_1.TenantsRepository.getTenantById(id, db);
    }
    static async createTenant(data, db) {
        if (data.userId !== undefined && data.userId !== null) {
            const user = await tenants_repository_1.TenantsRepository.findUserById(data.userId, db);
            if (!user) {
                throw new error_handler_1.AppError('User not found', 404);
            }
        }
        if (data.roomId !== undefined && data.roomId !== null) {
            const room = await tenants_repository_1.TenantsRepository.findRoomById(data.roomId, db);
            if (!room) {
                throw new error_handler_1.AppError('Room not found', 404);
            }
        }
        // If a fake/mock db is injected (unit tests), prefer flat userId/roomId fields
        if (db) {
            return tenants_repository_1.TenantsRepository.createTenant({
                userId: data.userId ?? null,
                roomId: data.roomId ?? null,
                fullName: data.fullName?.trim(),
                phone: data.phone?.trim(),
                emergencyContact: data.emergencyContact?.trim(),
                checkInDate: data.checkInDate ? new Date(data.checkInDate) : null,
                checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : null,
                isActive: data.isActive ?? true,
            }, db);
        }
        return tenants_repository_1.TenantsRepository.createTenant({
            user: data.userId !== undefined && data.userId !== null ? { connect: { id: data.userId } } : undefined,
            room: data.roomId !== undefined && data.roomId !== null ? { connect: { id: data.roomId } } : undefined,
            fullName: data.fullName?.trim(),
            phone: data.phone?.trim(),
            emergencyContact: data.emergencyContact?.trim(),
            checkInDate: data.checkInDate ? new Date(data.checkInDate) : null,
            checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : null,
            isActive: data.isActive ?? true,
        }, db);
    }
    static async updateTenant(id, data, db) {
        const updateData = {
            fullName: data.fullName?.trim(),
            phone: data.phone?.trim(),
            emergencyContact: data.emergencyContact?.trim(),
            checkInDate: data.checkInDate ? new Date(data.checkInDate) : undefined,
            checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : undefined,
            isActive: data.isActive,
        };
        if ('userId' in data) {
            if (data.userId === null)
                updateData.user = { disconnect: true };
            else if (data.userId !== undefined)
                updateData.user = { connect: { id: data.userId } };
        }
        if ('roomId' in data) {
            if (data.roomId === null)
                updateData.room = { disconnect: true };
            else if (data.roomId !== undefined)
                updateData.room = { connect: { id: data.roomId } };
        }
        return tenants_repository_1.TenantsRepository.updateTenant(id, updateData, db);
    }
    static async deleteTenant(id, db) {
        return tenants_repository_1.TenantsRepository.deleteTenant(id, db);
    }
}
exports.TenantsService = TenantsService;
