"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaintenanceController = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const api_response_1 = require("../../shared/api-response");
const maintenance_service_1 = require("./maintenance.service");
const error_handler_1 = require("../../middlewares/error-handler");
const state_transitions_1 = require("../../shared/state-transitions");
class MaintenanceController {
    static async createTicket(req, res, next) {
        try {
            const authReq = req;
            const { roomId, category, description, contactTime } = req.body;
            const tenant = await maintenance_service_1.MaintenanceService.getTenantByUserId(authReq.user?.id ?? 0);
            if (!tenant) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Tenant profile not found. Please complete your registration first.'));
            }
            const ticket = await maintenance_service_1.MaintenanceService.createTicket({
                tenantId: tenant.id,
                roomId: roomId ?? tenant.roomId ?? undefined,
                category,
                description,
                contactTime: contactTime ? new Date(contactTime) : undefined,
            });
            return res.status(201).json((0, api_response_1.createResponse)(201, 'Maintenance ticket created', ticket));
        }
        catch (error) {
            next(error);
        }
    }
    static async listTickets(req, res, next) {
        try {
            const authReq = req;
            const tickets = await maintenance_service_1.MaintenanceService.listTickets(authReq.user?.id, authReq.user?.role);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Maintenance tickets fetched', tickets));
        }
        catch (error) {
            next(error);
        }
    }
    static async updateTicketStatus(req, res, next) {
        try {
            const id = Number(req.params.id);
            const { status, note } = req.body;
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid ticket id'));
            }
            const existingTicket = await maintenance_service_1.MaintenanceService.getTicketById(id);
            if (!existingTicket) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Maintenance ticket not found'));
            }
            if (!(0, state_transitions_1.canTransitionMaintenanceStatus)(existingTicket.status, status)) {
                return next(new error_handler_1.AppError('Invalid maintenance state transition', 409));
            }
            const updated = await maintenance_service_1.MaintenanceService.updateTicketStatus(id, status, note);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Maintenance ticket updated', updated));
        }
        catch (error) {
            next(error);
        }
    }
    static async deleteTicket(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid ticket id'));
            }
            const existingTicket = await maintenance_service_1.MaintenanceService.getTicketById(id);
            if (!existingTicket) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Maintenance ticket not found'));
            }
            await maintenance_service_1.MaintenanceService.deleteTicket(id);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Maintenance ticket deleted'));
        }
        catch (error) {
            next(error);
        }
    }
    static async uploadImage(req, res, next) {
        try {
            const file = req.file;
            if (!file) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Image file is required'));
            }
            const uploadDir = path_1.default.resolve(process.env.UPLOAD_ROOT || path_1.default.join(process.cwd(), 'uploads/maintenance'));
            if (!fs_1.default.existsSync(uploadDir)) {
                fs_1.default.mkdirSync(uploadDir, { recursive: true });
            }
            const ext = path_1.default.extname(file.originalname) || '.jpg';
            const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
            const filepath = path_1.default.join(uploadDir, filename);
            await fs_1.default.promises.writeFile(filepath, file.buffer);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Image uploaded successfully', { filename }));
        }
        catch (error) {
            next(error);
        }
    }
    static async serveImage(req, res, next) {
        try {
            const filename = req.params.filename;
            const uploadDir = path_1.default.resolve(process.env.UPLOAD_ROOT || path_1.default.join(process.cwd(), 'uploads/maintenance'));
            const filepath = path_1.default.resolve(uploadDir, path_1.default.basename(filename));
            if (!filepath.startsWith(`${uploadDir}${path_1.default.sep}`)) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'Invalid image path'));
            }
            if (!fs_1.default.existsSync(filepath)) {
                return res.status(404).json((0, api_response_1.createResponse)(404, 'Image not found'));
            }
            return res.sendFile(filepath);
        }
        catch (error) {
            next(error);
        }
    }
}
exports.MaintenanceController = MaintenanceController;
