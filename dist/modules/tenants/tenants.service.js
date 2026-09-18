"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsService = void 0;
const db_1 = require("../../database/db");
const error_handler_1 = require("../../middlewares/error-handler");
const tenants_repository_1 = require("./tenants.repository");
const path_1 = __importDefault(require("path"));
const settings_service_1 = require("../settings/settings.service");
const date_utils_1 = require("../../shared/date-utils");
class TenantsService {
    static async getMaxOccupants() {
        return Number(await (0, settings_service_1.getSettingValue)('maxOccupants')) || 4;
    }
    static assertRoomHasCapacity(room, maxOccupants) {
        const configuredCapacity = Math.min(room.capacity || maxOccupants, maxOccupants);
        if ((room.tenants?.length ?? 0) >= configuredCapacity) {
            throw new error_handler_1.AppError(`ห้องพักเต็มตามข้อกำหนด ${maxOccupants} คน`, 409);
        }
    }
    static async listTenants(db) {
        const tenants = await tenants_repository_1.TenantsRepository.listTenants(undefined, undefined, db);
        return tenants.map((tenant) => ({
            ...tenant,
            age: (0, date_utils_1.calculateAge)(tenant.birthDate),
        }));
    }
    static async getTenantById(id, db) {
        const tenant = await tenants_repository_1.TenantsRepository.getTenantById(id, db);
        if (!tenant)
            return null;
        return {
            ...tenant,
            age: (0, date_utils_1.calculateAge)(tenant.birthDate),
        };
    }
    static async getTenantByUserId(userId, db) {
        const tenant = await tenants_repository_1.TenantsRepository.getTenantByUserId(userId, db);
        if (!tenant)
            return null;
        return {
            ...tenant,
            age: (0, date_utils_1.calculateAge)(tenant.birthDate),
        };
    }
    static resolveTenantDocumentPath(documentPath) {
        if (!documentPath) {
            throw new error_handler_1.AppError('Document not found', 404);
        }
        const uploadRoot = path_1.default.resolve(process.env.UPLOAD_ROOT || path_1.default.join(process.cwd(), 'uploads/private'));
        const normalizedPath = documentPath.replace(/^uploads[\\/ ]*private[\\/]?/u, '');
        const resolvedPath = path_1.default.resolve(uploadRoot, normalizedPath);
        if (resolvedPath !== uploadRoot && !resolvedPath.startsWith(`${uploadRoot}${path_1.default.sep}`)) {
            throw new error_handler_1.AppError('Invalid document path', 400);
        }
        return resolvedPath;
    }
    static async submitApplication(data, db) {
        const { personalInformation, emergencyContact, roomPreference, ocrData, idCardImagePath, paymentSlipPath, contractData, userId } = data;
        if (!personalInformation?.fullName?.trim()) {
            throw new error_handler_1.AppError('Full Name is required', 400);
        }
        const tenantPayload = {
            fullName: personalInformation.fullName.trim(),
            studentId: personalInformation.studentId?.trim(),
            course: personalInformation.course?.trim(),
            yearLevel: personalInformation.yearLevel,
            phone: personalInformation.contactNumber?.trim(),
            email: personalInformation.emailAddress?.trim(),
            emergencyName: emergencyContact?.emergencyName?.trim(),
            emergencyRelation: emergencyContact?.relationship,
            emergencyContact: emergencyContact?.emergencyNumber?.trim(),
            preferredRoomType: roomPreference?.preferredRoomType,
            notes: roomPreference?.notes?.trim(),
            citizenId: ocrData?.citizenId?.trim(),
            address: ocrData?.address?.trim(),
            birthDate: ocrData?.birthDate?.trim(),
            idCardImagePath,
            paymentSlipPath,
            contractData: contractData ? JSON.stringify(contractData) : null,
            status: 'PENDING',
            isActive: true,
        };
        const client = db || db_1.prisma;
        // Resolve room assignment (selected room or random room on chosen floor)
        let targetRoomId = null;
        const requestedRoomNumber = roomPreference?.roomNumber?.trim() || (contractData?.roomNumber ? String(contractData.roomNumber).trim() : '');
        if (requestedRoomNumber) {
            const room = await client.room.findUnique({
                where: { roomNumber: requestedRoomNumber },
            });
            if (room) {
                const maxOccupants = await this.getMaxOccupants();
                const roomWithTenants = await client.room.findUnique({ where: { id: room.id }, include: { tenants: { where: { isActive: true } } } });
                this.assertRoomHasCapacity({ capacity: room.capacity, tenants: roomWithTenants?.tenants }, maxOccupants);
                targetRoomId = room.id;
            }
        }
        else if (roomPreference?.isRandomRoom) {
            const floorMatch = roomPreference?.preferredRoomType?.match(/Floor\s*(\d+)/i) || roomPreference?.preferredRoomType?.match(/ชั้น\s*(\d+)/i);
            const floorNum = floorMatch ? parseInt(floorMatch[1], 10) : undefined;
            const availableRooms = await client.room.findMany({
                where: {
                    ...(floorNum ? { floor: floorNum } : {}),
                    status: 'AVAILABLE',
                },
                include: { tenants: true },
            });
            const maxOccupants = await this.getMaxOccupants();
            const openRooms = availableRooms.filter((r) => (r.tenants?.length ?? 0) < Math.min(r.capacity ?? maxOccupants, maxOccupants));
            if (openRooms.length > 0) {
                const randomIndex = Math.floor(Math.random() * openRooms.length);
                targetRoomId = openRooms[randomIndex].id;
            }
        }
        if (targetRoomId) {
            tenantPayload.room = { connect: { id: targetRoomId } };
        }
        if (userId) {
            const existing = await client.tenant.findUnique({ where: { userId } });
            if (existing) {
                return client.tenant.update({
                    where: { userId },
                    data: tenantPayload,
                });
            }
            tenantPayload.user = { connect: { id: userId } };
        }
        return client.tenant.create({ data: tenantPayload });
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
            const client = db || db_1.prisma;
            const roomWithTenants = await client.room.findUnique({ where: { id: data.roomId }, include: { tenants: { where: { isActive: true } } } });
            this.assertRoomHasCapacity({ capacity: room.capacity, tenants: roomWithTenants?.tenants }, await this.getMaxOccupants());
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
        const client = db || db_1.prisma;
        if (data.status !== undefined && !['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'INACTIVE'].includes(data.status)) {
            throw new error_handler_1.AppError('Invalid tenant status', 400);
        }
        const tenant = await client.tenant.findUnique({
            where: { id },
            include: { room: true },
        });
        if (!tenant) {
            throw new error_handler_1.AppError('Tenant not found', 404);
        }
        const updateData = {
            fullName: data.fullName?.trim(),
            phone: data.phone?.trim(),
            emergencyContact: data.emergencyContact?.trim(),
            checkInDate: data.checkInDate ? new Date(data.checkInDate) : undefined,
            checkOutDate: data.checkOutDate ? new Date(data.checkOutDate) : undefined,
            isActive: data.isActive,
            status: data.status,
        };
        if ('userId' in data) {
            if (data.userId === null)
                updateData.user = { disconnect: true };
            else if (data.userId !== undefined)
                updateData.user = { connect: { id: data.userId } };
        }
        // Determine room updates and status changes
        let nextRoomId = undefined;
        if ('roomId' in data) {
            nextRoomId = data.roomId;
        }
        const isBecomingActive = data.status === 'APPROVED' || data.status === 'ACTIVE';
        const isBecomingInactive = data.status === 'PENDING' || data.status === 'REJECTED' || data.status === 'INACTIVE';
        if (isBecomingActive && !tenant.roomId && nextRoomId === undefined) {
            // Auto-assign random available room
            const rooms = await client.room.findMany({
                include: { tenants: true },
            });
            const maxOccupants = await this.getMaxOccupants();
            const availableRooms = rooms.filter((r) => r.tenants.length < Math.min(r.capacity ?? maxOccupants, maxOccupants));
            if (availableRooms.length > 0) {
                const randomIndex = Math.floor(Math.random() * availableRooms.length);
                const selectedRoom = availableRooms[randomIndex];
                updateData.room = { connect: { id: selectedRoom.id } };
                const newOccupantsCount = selectedRoom.tenants.length + 1;
                const isNowOccupied = newOccupantsCount >= (selectedRoom.capacity ?? 4);
                await client.room.update({
                    where: { id: selectedRoom.id },
                    data: { status: isNowOccupied ? 'OCCUPIED' : 'AVAILABLE' },
                });
            }
            else {
                throw new error_handler_1.AppError('No available rooms in the system', 400);
            }
        }
        else if (isBecomingInactive && tenant.roomId) {
            // Release current room and disconnect it
            updateData.room = { disconnect: true };
            const currentRoom = await client.room.findUnique({
                where: { id: tenant.roomId },
                include: { tenants: true },
            });
            // The current tenant is still in the room during this query, count minus 1
            const occupantsCount = Math.max(0, (currentRoom?.tenants?.length ?? 0) - 1);
            const isNowOccupied = occupantsCount >= (currentRoom?.capacity ?? 4);
            await client.room.update({
                where: { id: tenant.roomId },
                data: { status: isNowOccupied ? 'OCCUPIED' : 'AVAILABLE' },
            });
        }
        else if (nextRoomId !== undefined) {
            // Explicit roomId changes
            if (nextRoomId === null) {
                if (tenant.roomId) {
                    updateData.room = { disconnect: true };
                    const currentRoom = await client.room.findUnique({
                        where: { id: tenant.roomId },
                        include: { tenants: true },
                    });
                    const occupantsCount = Math.max(0, (currentRoom?.tenants?.length ?? 0) - 1);
                    await client.room.update({
                        where: { id: tenant.roomId },
                        data: { status: occupantsCount >= (currentRoom?.capacity ?? 4) ? 'OCCUPIED' : 'AVAILABLE' },
                    });
                }
            }
            else {
                if (tenant.roomId && tenant.roomId !== nextRoomId) {
                    const prevRoom = await client.room.findUnique({
                        where: { id: tenant.roomId },
                        include: { tenants: true },
                    });
                    const occupantsCount = Math.max(0, (prevRoom?.tenants?.length ?? 0) - 1);
                    await client.room.update({
                        where: { id: tenant.roomId },
                        data: { status: occupantsCount >= (prevRoom?.capacity ?? 4) ? 'OCCUPIED' : 'AVAILABLE' },
                    });
                }
                updateData.room = { connect: { id: nextRoomId } };
                const targetRoom = await client.room.findUnique({
                    where: { id: nextRoomId },
                    include: { tenants: true },
                });
                if (!targetRoom)
                    throw new error_handler_1.AppError('Room not found', 404);
                const maxOccupants = await this.getMaxOccupants();
                this.assertRoomHasCapacity(targetRoom, maxOccupants);
                const targetOccupantsCount = (targetRoom?.tenants?.length ?? 0) + 1;
                const isNowOccupied = targetOccupantsCount >= (targetRoom?.capacity ?? 4);
                await client.room.update({
                    where: { id: nextRoomId },
                    data: { status: isNowOccupied ? 'OCCUPIED' : 'AVAILABLE' },
                });
            }
        }
        else if (isBecomingActive && tenant.roomId) {
            const currentRoom = await client.room.findUnique({
                where: { id: tenant.roomId },
                include: { tenants: true },
            });
            // The current tenant might not be linked in the relations yet (if status was pending)
            const hasSelf = currentRoom?.tenants?.some((t) => t.id === tenant.id);
            const occupantsCount = (currentRoom?.tenants?.length ?? 0) + (hasSelf ? 0 : 1);
            const isNowOccupied = occupantsCount >= (currentRoom?.capacity ?? 4);
            await client.room.update({
                where: { id: tenant.roomId },
                data: { status: isNowOccupied ? 'OCCUPIED' : 'AVAILABLE' },
            });
        }
        return tenants_repository_1.TenantsRepository.updateTenant(id, updateData, client);
    }
    static async deleteTenant(id, db) {
        const tenant = await tenants_repository_1.TenantsRepository.getTenantById(id, db);
        if (!tenant) {
            throw new error_handler_1.AppError('Tenant not found', 404);
        }
        return tenants_repository_1.TenantsRepository.deleteTenant(id, db);
    }
}
exports.TenantsService = TenantsService;
