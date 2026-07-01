"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaintenanceController = void 0;
const api_response_1 = require("../../shared/api-response");
const maintenance_service_1 = require("./maintenance.service");
const error_handler_1 = require("../../middlewares/error-handler");
const state_transitions_1 = require("../../shared/state-transitions");
class MaintenanceController {
    static async createTicket(req, res, next) {
        try {
            const authReq = req;
            const { roomId, category, description, contactTime } = req.body;
            const ticket = await maintenance_service_1.MaintenanceService.createTicket({
                tenantId: authReq.user?.id ?? 0,
                roomId,
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
}
exports.MaintenanceController = MaintenanceController;
