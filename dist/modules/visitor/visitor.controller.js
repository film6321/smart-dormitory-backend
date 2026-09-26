"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisitorController = void 0;
const api_response_1 = require("../../shared/api-response");
const error_handler_1 = require("../../middlewares/error-handler");
const state_transitions_1 = require("../../shared/state-transitions");
const visitor_service_1 = require("./visitor.service");
const getUploadedFileFromFields = (files) => {
    if (!files || Array.isArray(files)) {
        return undefined;
    }
    return files.file?.[0] ?? files.image?.[0] ?? files.idCard?.[0] ?? files.document?.[0];
};
class VisitorController {
    static async scanVisitorIdCard(req, res, next) {
        try {
            const { imageBase64 } = req.body || {};
            const uploadedFile = req.file ?? getUploadedFileFromFields(req.files);
            const inputImageBase64 = uploadedFile
                ? `data:${uploadedFile.mimetype};base64,${uploadedFile.buffer.toString('base64')}`
                : imageBase64;
            if (!inputImageBase64 || typeof inputImageBase64 !== 'string') {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'กรุณาแนบรูปภาพบัตรประชาชน (imageBase64 หรือ อัปโหลดไฟล์)'));
            }
            const parsedData = await visitor_service_1.VisitorService.scanVisitorIdCard(inputImageBase64);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'อ่านข้อมูลบัตรประชาชนสำเร็จ', parsedData));
        }
        catch (error) {
            next(error);
        }
    }
    static async registerVisitor(req, res, next) {
        try {
            const { guestName, phone, citizenId, relationship, age, birthDate, address, idCardImagePath, purpose, roomId, roomNumber, tenantId, tenantName, expectedEntryTime, pdpaConsent, } = req.body || {};
            const visitor = await visitor_service_1.VisitorService.registerVisitor({
                guestName,
                phone,
                citizenId,
                relationship,
                age: age !== undefined && age !== null ? Number(age) : undefined,
                birthDate,
                address,
                idCardImagePath,
                purpose,
                roomId: roomId ? Number(roomId) : undefined,
                roomNumber: typeof roomNumber === 'string' ? roomNumber : (typeof roomId === 'string' && isNaN(Number(roomId)) ? roomId : undefined),
                tenantId: tenantId ? Number(tenantId) : undefined,
                tenantName: typeof tenantName === 'string' ? tenantName : undefined,
                expectedEntryTime: expectedEntryTime ? new Date(expectedEntryTime) : undefined,
                pdpaConsent: Boolean(pdpaConsent),
            });
            return res.status(201).json((0, api_response_1.createResponse)(201, 'ลงทะเบียนผู้มาติดต่อสำเร็จ', visitor));
        }
        catch (error) {
            next(error);
        }
    }
    static async getVisitorPass(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'รหัสผู้มาติดต่อไม่ถูกต้อง'));
            }
            const pass = await visitor_service_1.VisitorService.getVisitorPass(id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'ดึงข้อมูลบัตรผู้มาติดต่อสำเร็จ', pass));
        }
        catch (error) {
            next(error);
        }
    }
    static async cancelVisitor(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'รหัสผู้มาติดต่อไม่ถูกต้อง'));
            }
            const { reason } = req.body;
            const cancelled = await visitor_service_1.VisitorService.cancelVisitor(id, reason);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'ยกเลิกการลงทะเบียนผู้มาติดต่อสำเร็จ', cancelled));
        }
        catch (error) {
            next(error);
        }
    }
    static async listVisitors(req, res, next) {
        try {
            const visitors = await visitor_service_1.VisitorService.listVisitors();
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Visitors fetched', visitors));
        }
        catch (error) {
            next(error);
        }
    }
    static async updateVisitorStatus(req, res, next) {
        try {
            const id = Number(req.params.id);
            const { status } = req.body;
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid visitor id'));
            }
            const existingVisitor = await visitor_service_1.VisitorService.getVisitorById(id);
            if (!existingVisitor) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Visitor not found'));
            }
            if (!(0, state_transitions_1.canTransitionVisitorStatus)(existingVisitor.status, status)) {
                return next(new error_handler_1.AppError('Invalid visitor state transition', 409));
            }
            const updated = await visitor_service_1.VisitorService.updateVisitorStatus(id, status);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Visitor status updated', updated));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.VisitorController = VisitorController;
