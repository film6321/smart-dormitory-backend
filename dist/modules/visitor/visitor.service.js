"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisitorService = void 0;
const notification_service_1 = __importDefault(require("../notifications/notification.service"));
const error_handler_1 = require("../../middlewares/error-handler");
const settings_service_1 = require("../settings/settings.service");
const visitor_repository_1 = require("./visitor.repository");
const client_1 = require("@prisma/client");
const db_1 = require("../../database/db");
const notification_gateway_1 = require("../../realtime/notification-gateway");
const ocr_service_1 = require("../ocr/ocr.service");
const maskCitizenId = (citizenId) => {
    if (!citizenId)
        return undefined;
    const normalized = citizenId.replace(/\D/g, '');
    if (normalized.length < 5)
        return '*'.repeat(normalized.length);
    return `${normalized.slice(0, 3)}${'*'.repeat(Math.max(normalized.length - 5, 0))}${normalized.slice(-2)}`;
};
const isVisitorStatus = (status) => {
    return Object.values(client_1.VisitorStatus).includes(status);
};
class VisitorService {
    static async getVisitorById(id) {
        return visitor_repository_1.VisitorRepository.getVisitorById(id);
    }
    static async scanVisitorIdCard(imageBase64) {
        if (!imageBase64 || typeof imageBase64 !== 'string') {
            throw new error_handler_1.AppError('กรุณาแนบรูปภาพบัตรประชาชน', 400);
        }
        const ocrResult = await ocr_service_1.OcrService.verifyIdCard(imageBase64);
        return {
            cardDetected: ocrResult.confidence.idDetected,
            isThaiIdCard: ocrResult.isThaiIdCard,
            guestName: ocrResult.fullNameTh || '',
            citizenId: ocrResult.citizenId || '',
            citizenIdMasked: ocrResult.citizenIdMasked || (ocrResult.citizenId ? maskCitizenId(ocrResult.citizenId) : ''),
            birthDate: ocrResult.birthDateTh || '',
            age: ocrResult.age,
            address: ocrResult.address || '',
            idCardImagePath: ocrResult.imagePath || '',
            reason: ocrResult.reason,
        };
    }
    static async registerVisitor(data) {
        if (!data.pdpaConsent) {
            throw new error_handler_1.AppError('กรุณายินยอมข้อตกลงการประมวลผลข้อมูลส่วนบุคคล (PDPA) ก่อนดำเนินการ', 400);
        }
        if (!data.guestName || data.guestName.trim().length < 2) {
            throw new error_handler_1.AppError('กรุณาระบุชื่อ-นามสกุลของผู้มาติดต่อ', 400);
        }
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours TTL
        const cleanCitizenId = data.citizenId ? data.citizenId.replace(/\D/g, '') : undefined;
        const citizenIdMasked = cleanCitizenId ? maskCitizenId(cleanCitizenId) : undefined;
        const createData = {
            guestName: data.guestName.trim(),
            phone: data.phone?.trim() || undefined,
            citizenId: cleanCitizenId || undefined,
            citizenIdMasked,
            relationship: data.relationship?.trim() || undefined,
            age: data.age !== undefined && data.age !== null ? Number(data.age) : undefined,
            birthDate: data.birthDate?.trim() || undefined,
            address: data.address?.trim() || undefined,
            idCardImagePath: data.idCardImagePath?.trim() || undefined,
            purpose: data.purpose?.trim() || undefined,
            expectedEntryTime: data.expectedEntryTime,
            status: 'REGISTERED',
            pdpaConsent: true,
            pdpaConsentAt: now,
            expiresAt,
        };
        let targetRoomId = data.roomId && Number.isInteger(Number(data.roomId)) && Number(data.roomId) > 0 ? Number(data.roomId) : undefined;
        if (!targetRoomId && (data.roomNumber || (typeof data.roomId === 'string' && data.roomId.trim().length > 0))) {
            const rawRoom = (data.roomNumber || String(data.roomId)).trim();
            const roomMatch = rawRoom.match(/\d+/);
            const roomNumberStr = roomMatch ? roomMatch[0] : rawRoom;
            const foundRoom = await db_1.prisma.room.findFirst({
                where: {
                    OR: [
                        { roomNumber: roomNumberStr },
                        { roomNumber: rawRoom },
                    ],
                },
            });
            if (foundRoom) {
                targetRoomId = foundRoom.id;
            }
        }
        if (targetRoomId) {
            createData.room = { connect: { id: targetRoomId } };
        }
        let targetTenantId = data.tenantId && Number.isInteger(Number(data.tenantId)) && Number(data.tenantId) > 0 ? Number(data.tenantId) : undefined;
        if (!targetTenantId && data.tenantName && data.tenantName.trim().length > 0) {
            const foundTenant = await db_1.prisma.tenant.findFirst({
                where: {
                    fullName: { contains: data.tenantName.trim(), mode: 'insensitive' },
                },
            });
            if (foundTenant) {
                targetTenantId = foundTenant.id;
            }
        }
        if (targetTenantId) {
            createData.tenant = { connect: { id: targetTenantId } };
        }
        const visitor = await db_1.prisma.$transaction(async (tx) => {
            const created = await tx.visitor.create({
                data: createData,
                include: {
                    room: { select: { roomNumber: true } },
                    tenant: { select: { fullName: true, studentId: true } },
                },
            });
            // Generate QR Code data payload
            const qrPayload = JSON.stringify({
                visitorId: created.id,
                guestName: created.guestName,
                phone: created.phone,
                relationship: created.relationship,
                roomNumber: created.room?.roomNumber,
                purpose: created.purpose,
                expectedEntryTime: created.expectedEntryTime,
                expiresAt: created.expiresAt,
                type: 'VISITOR_PASS',
            });
            const updatedWithQr = await tx.visitor.update({
                where: { id: created.id },
                data: { qrCodeData: qrPayload },
                include: {
                    room: { select: { roomNumber: true } },
                    tenant: { select: { fullName: true, studentId: true } },
                },
            });
            await tx.visitorLog.create({
                data: {
                    visitorId: created.id,
                    eventType: 'REGISTERED',
                    note: 'ผู้มาติดต่อลงทะเบียนสำเร็จ (มีอายุ 24 ชั่วโมง)',
                },
            });
            return updatedWithQr;
        });
        if (visitor.tenantId) {
            try {
                const notificationService = new notification_service_1.default();
                await notificationService.scheduleNotification({
                    tenantId: visitor.tenantId,
                    channel: 'SMS',
                    type: 'VISITOR_ARRIVAL',
                    payload: JSON.stringify({ message: `Visitor ${visitor.guestName} registered`, visitorId: visitor.id }),
                });
            }
            catch {
                // Notification failure shouldn't rollback registration
            }
        }
        (0, notification_gateway_1.publishAdminAlert)(visitor.id, 'VISITOR_REGISTERED', `มีผู้มาติดต่อลงทะเบียนใหม่: ${visitor.guestName}`, 'REGISTERED');
        return visitor;
    }
    static async getVisitorPass(id) {
        const visitor = await visitor_repository_1.VisitorRepository.getVisitorById(id);
        if (!visitor) {
            throw new error_handler_1.AppError('ไม่พบข้อมูลการลงทะเบียนของผู้มาติดต่อ', 404);
        }
        const now = new Date();
        const isExpired = visitor.expiresAt ? now > visitor.expiresAt : false;
        const canCancel = (visitor.status === 'REGISTERED' || visitor.status === 'APPROVED' || visitor.status === 'VERIFYING') && !isExpired;
        return {
            id: visitor.id,
            guestName: visitor.guestName,
            phone: visitor.phone,
            citizenIdMasked: visitor.citizenIdMasked,
            relationship: visitor.relationship,
            age: visitor.age,
            birthDate: visitor.birthDate,
            address: visitor.address,
            purpose: visitor.purpose,
            roomNumber: visitor.room?.roomNumber,
            tenantName: visitor.tenant?.fullName,
            expectedEntryTime: visitor.expectedEntryTime,
            status: visitor.status,
            expiresAt: visitor.expiresAt,
            qrCodeData: visitor.qrCodeData,
            isExpired,
            canCancel,
            createdAt: visitor.createdAt,
        };
    }
    static async cancelVisitor(id, reason) {
        const visitor = await visitor_repository_1.VisitorRepository.getVisitorById(id);
        if (!visitor) {
            throw new error_handler_1.AppError('ไม่พบข้อมูลการลงทะเบียนของผู้มาติดต่อ', 404);
        }
        if (visitor.status === 'CANCELLED') {
            return visitor;
        }
        if (visitor.status === 'CHECKED_IN' || visitor.status === 'CHECKED_OUT') {
            throw new error_handler_1.AppError('ไม่สามารถยกเลิกได้เนื่องจากผู้มาติดต่อได้ทำการเช็คอินเข้าหอพักแล้ว', 409);
        }
        const now = new Date();
        if (visitor.expiresAt && now > visitor.expiresAt) {
            throw new error_handler_1.AppError('ไม่สามารถยกเลิกได้เนื่องจากคำขอหมดอายุแล้ว (เกินกำหนด 24 ชั่วโมง)', 409);
        }
        const updated = await db_1.prisma.$transaction(async (tx) => {
            const cancelled = await tx.visitor.update({
                where: { id },
                data: {
                    status: 'CANCELLED',
                    cancelledAt: now,
                },
                include: {
                    room: { select: { roomNumber: true } },
                    tenant: { select: { fullName: true, studentId: true } },
                },
            });
            await tx.visitorLog.create({
                data: {
                    visitorId: id,
                    eventType: 'CANCELLED',
                    note: reason || 'ผู้มาติดต่อขอยกเลิกคำขอลงทะเบียน',
                },
            });
            return cancelled;
        });
        (0, notification_gateway_1.publishAdminAlert)(updated.id, 'VISITOR_CANCELLED', `ผู้มาติดต่อ ${updated.guestName} ยกเลิกการลงทะเบียน`, 'CANCELLED');
        return updated;
    }
    static async listVisitors() {
        return visitor_repository_1.VisitorRepository.listVisitors();
    }
    static async updateVisitorStatus(id, status) {
        const now = new Date();
        if (status === 'CHECKED_IN') {
            const checkInTime = await (0, settings_service_1.getSettingValue)('checkInTime');
            const checkOutTime = await (0, settings_service_1.getSettingValue)('checkOutTime');
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const [checkInHour, checkInMinute] = checkInTime.split(':').map(Number);
            const [checkOutHour, checkOutMinute] = checkOutTime.split(':').map(Number);
            const start = checkInHour * 60 + checkInMinute;
            const end = checkOutHour * 60 + checkOutMinute;
            const isWithinWindow = start <= end
                ? currentMinutes >= start && currentMinutes <= end
                : currentMinutes >= start || currentMinutes <= end;
            if (!Number.isFinite(start) || !Number.isFinite(end) || !isWithinWindow) {
                throw new error_handler_1.AppError(`Check-in เปิดให้บริการเวลา ${checkInTime} - ${checkOutTime}`, 409);
            }
        }
        if (!isVisitorStatus(status)) {
            throw new error_handler_1.AppError('สถานะผู้มาติดต่อไม่ถูกต้อง', 400);
        }
        const data = {
            status,
        };
        if (status === 'CHECKED_IN')
            data.checkedInAt = now;
        if (status === 'CHECKED_OUT')
            data.checkedOutAt = now;
        const visitor = await db_1.prisma.$transaction(async (transaction) => {
            const updated = await visitor_repository_1.VisitorRepository.updateVisitorStatus(id, data, transaction);
            await transaction.visitorLog.create({
                data: {
                    visitorId: id,
                    eventType: status,
                    note: status === 'CHECKED_IN' ? 'ผู้มาติดต่อเข้าหอพัก' : status === 'CHECKED_OUT' ? 'ผู้มาติดต่อออกจากหอพัก' : undefined,
                },
            });
            return updated;
        });
        const actionLabel = status === 'CHECKED_IN' ? 'Check-in' : status === 'CHECKED_OUT' ? 'Check-out' : `เปลี่ยนสถานะเป็น ${status}`;
        (0, notification_gateway_1.publishAdminAlert)(visitor.id, 'VISITOR_STATUS', `ผู้มาติดต่อ ${visitor.guestName}: ${actionLabel}`, status);
        return visitor;
    }
}
exports.VisitorService = VisitorService;
