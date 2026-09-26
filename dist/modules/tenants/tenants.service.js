"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantsService = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const housing_payment_service_1 = require("./housing-payment.service");
const ocr_service_1 = require("../ocr/ocr.service");
const tenants_dto_1 = require("./tenants.dto");
const logger_1 = require("../../logger");
const db_1 = require("../../database/db");
const error_handler_1 = require("../../middlewares/error-handler");
const tenants_repository_1 = require("./tenants.repository");
const path_1 = __importDefault(require("path"));
const settings_service_1 = require("../settings/settings.service");
const date_utils_1 = require("../../shared/date-utils");
const notification_gateway_1 = require("../../realtime/notification-gateway");
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
    static async uploadDocuments(idCardFile, paymentSlipFile, userId, roomNumber) {
        let result;
        try {
            result = await ocr_service_1.OcrService.verifyIdCard(`data:${idCardFile.mimetype};base64,${idCardFile.buffer.toString('base64')}`, { userId });
        }
        catch (error) {
            if (error instanceof error_handler_1.AppError) {
                throw error;
            }
            logger_1.logger.warn({ err: error, userId }, 'Housing application OCR unavailable');
            throw new error_handler_1.AppError('ไม่สามารถตรวจสอบบัตรประชาชนได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง', 503);
        }
        if (!result.confidence.idDetected) {
            throw new error_handler_1.AppError('ภาพนี้ไม่ผ่านการตรวจว่าเป็นบัตรประชาชน กรุณาอัปโหลดบัตรประชาชนใหม่', 422);
        }
        if (!result.verificationId || !result.imagePath) {
            throw new error_handler_1.AppError('ไม่สามารถบันทึกผลตรวจบัตรประชาชนได้ กรุณาลองใหม่', 503);
        }
        let payment;
        try {
            payment = await housing_payment_service_1.HousingPaymentService.verifySlip(roomNumber, userId, paymentSlipFile, result.verificationId);
        }
        catch (error) {
            if (error instanceof error_handler_1.AppError)
                throw new error_handler_1.AppError(`ตรวจบัตรประชาชนแล้ว แต่ยังไม่ผ่านการตรวจสลิป: ${error.message}`, error.statusCode);
            throw error;
        }
        const readable = (value) => ((0, tenants_dto_1.isFilledText)(value) && !value.includes('*') ? value.trim() : '');
        return {
            idCardImagePath: result.imagePath,
            paymentSlipPath: payment.slipPath,
            paymentVerification: { id: payment.id, status: 'PAID', amount: Number(payment.amount) },
            ocrData: {
                verificationId: result.verificationId,
                cardDetected: true,
                isThaiIdCard: result.isThaiIdCard,
                citizenId: result.confidence.idChecksumValid && /^\d{13}$/.test(result.citizenId || '') ? result.citizenId : '',
                fullNameTh: readable(result.fullNameTh),
                birthDateTh: readable(result.birthDateTh),
                age: result.age ?? null,
                address: readable(result.address),
            },
        };
    }
    static async submitApplication(data, db) {
        if (!db)
            return db_1.prisma.$transaction((tx) => this.submitApplication(data, tx), { timeout: 15000 });
        const { personalInformation, emergencyContact, roomPreference, ocrData, idCardImagePath, paymentSlipPath, contractData, userId } = data;
        const validatedContract = (0, tenants_dto_1.validateHousingApplication)(data);
        const client = db || db_1.prisma;
        const payment = await housing_payment_service_1.HousingPaymentService.requireVerifiedPayment(client, {
            paymentId: data.paymentId, userId: userId, roomNumber: roomPreference.roomNumber.trim(),
            verificationId: ocrData.verificationId, slipPath: paymentSlipPath,
            monthlyRent: validatedContract.monthlyRent, depositAmount: validatedContract.depositAmount,
        });
        if (payment.housingTenantId) {
            const existing = await client.tenant.findUnique({ where: { id: payment.housingTenantId } });
            if (existing && existing.userId === userId)
                return existing;
            throw new error_handler_1.AppError('รายการชำระนี้ถูกใช้ยื่นใบสมัครแล้ว', 409);
        }
        if (validatedContract.roomNumber !== roomPreference.roomNumber.trim()) {
            throw new error_handler_1.AppError('ห้องในสัญญาไม่ตรงกับห้องที่ชำระเงิน', 400);
        }
        const verification = await client.idCardVerification.findUnique({
            where: { id: ocrData.verificationId },
        });
        if (!verification || verification.userId !== userId || !verification.idDetected || !verification.imagePath) {
            throw new error_handler_1.AppError('ไม่พบผลตรวจบัตรประชาชนที่ผ่านสำหรับผู้ใช้นี้ กรุณาอัปโหลดใหม่', 422);
        }
        const verifiedPath = this.resolveTenantDocumentPath(verification.imagePath);
        const submittedPath = this.resolveTenantDocumentPath(idCardImagePath);
        const slipPath = this.resolveTenantDocumentPath(paymentSlipPath);
        const slipRoot = path_1.default.resolve(process.env.UPLOAD_ROOT || path_1.default.join(process.cwd(), 'uploads/private'), 'payment-slips');
        if (verifiedPath !== submittedPath || path_1.default.dirname(slipPath) !== slipRoot) {
            throw new error_handler_1.AppError('เอกสารไม่ตรงกับผลตรวจบัตรประชาชน กรุณาอัปโหลดใหม่', 400);
        }
        try {
            await Promise.all([promises_1.default.access(verifiedPath), promises_1.default.access(slipPath)]);
        }
        catch {
            throw new error_handler_1.AppError('ไม่พบไฟล์เอกสาร กรุณาอัปโหลดใหม่', 400);
        }
        const tenantPayload = {
            fullName: validatedContract.tenantName,
            studentId: personalInformation.studentId?.trim(),
            course: personalInformation.course?.trim(),
            yearLevel: personalInformation.yearLevel,
            phone: validatedContract.tenantPhone,
            email: personalInformation.emailAddress?.trim(),
            emergencyName: emergencyContact?.emergencyName?.trim(),
            emergencyRelation: emergencyContact?.relationship,
            emergencyContact: emergencyContact?.emergencyNumber?.trim(),
            preferredRoomType: roomPreference?.preferredRoomType,
            notes: roomPreference?.notes?.trim(),
            citizenId: validatedContract.tenantCitizenId,
            address: validatedContract.tenantAddress,
            birthDate: verification.birthDateTh || undefined,
            idCardImagePath,
            paymentSlipPath,
            contractData: JSON.stringify(validatedContract),
            status: 'PENDING',
            isActive: true,
        };
        // The verified payment identifies the concrete room, including a room picked randomly in the UI.
        let targetRoomId = null;
        const requestedRoomNumber = roomPreference?.roomNumber?.trim() || (contractData?.roomNumber ? String(contractData.roomNumber).trim() : '');
        if (requestedRoomNumber) {
            const room = await client.room.findUnique({
                where: { roomNumber: requestedRoomNumber },
            });
            if (room) {
                if (room.status !== 'AVAILABLE')
                    throw new error_handler_1.AppError('ห้องไม่พร้อมรับสมัคร กรุณาติดต่อเจ้าหน้าที่', 409);
                const maxOccupants = await this.getMaxOccupants();
                const roomWithTenants = await client.room.findUnique({ where: { id: room.id }, include: { tenants: { where: { isActive: true } } } });
                this.assertRoomHasCapacity({ capacity: room.capacity, tenants: roomWithTenants?.tenants }, maxOccupants);
                targetRoomId = room.id;
            }
        }
        if (targetRoomId) {
            tenantPayload.room = { connect: { id: targetRoomId } };
        }
        if (!targetRoomId || targetRoomId !== payment.housingRoomId) {
            throw new error_handler_1.AppError('ห้องไม่ตรงกับรายการชำระเงิน กรุณาติดต่อเจ้าหน้าที่', 409);
        }
        // OCC serializes submissions by this applicant without trusting browser state.
        const applicant = await client.user.findUnique({ where: { id: userId }, select: { version: true } });
        if (!applicant)
            throw new error_handler_1.AppError('ไม่พบผู้สมัคร', 404);
        const claimedUser = await client.user.updateMany({
            where: { id: userId, version: applicant.version }, data: { version: { increment: 1 } },
        });
        if (claimedUser.count !== 1)
            throw new error_handler_1.AppError('มีคำขอยื่นใบสมัครพร้อมกัน กรุณาลองใหม่', 409);
        const existing = await client.tenant.findUnique({ where: { userId } });
        if (existing && ['APPROVED', 'ACTIVE'].includes(existing.status)) {
            throw new error_handler_1.AppError('ใบสมัครได้รับการอนุมัติแล้ว ไม่สามารถส่งทับได้', 409);
        }
        const tenant = existing
            ? await client.tenant.update({ where: { id: existing.id }, data: tenantPayload })
            : await client.tenant.create({ data: { ...tenantPayload, user: { connect: { id: userId } } } });
        const consumed = await client.payment.updateMany({
            where: { id: payment.id, status: 'PAID', housingTenantId: null }, data: { housingTenantId: tenant.id },
        });
        if (consumed.count !== 1)
            throw new error_handler_1.AppError('รายการชำระนี้ถูกใช้ยื่นใบสมัครแล้ว', 409);
        return tenant;
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
        const updated = await tenants_repository_1.TenantsRepository.updateTenant(id, updateData, client);
        if (updated) {
            (0, notification_gateway_1.publishAdminAlert)(updated.id, 'TENANT_STATUS', `อัปเดตสถานะผู้พักอาศัย ${updated.fullName || ''}: ${updated.status || 'ACTIVE'}`, updated.status || 'ACTIVE');
        }
        return updated;
    }
    static async deleteTenant(id, db) {
        const tenant = await tenants_repository_1.TenantsRepository.getTenantById(id, db);
        if (!tenant) {
            throw new error_handler_1.AppError('Tenant not found', 404);
        }
        const result = await tenants_repository_1.TenantsRepository.deleteTenant(id, db);
        (0, notification_gateway_1.publishAdminAlert)(id, 'TENANT_STATUS', `ลบข้อมูลผู้พักอาศัย #${id}`, 'DELETED');
        return result;
    }
}
exports.TenantsService = TenantsService;
