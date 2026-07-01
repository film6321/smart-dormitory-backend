"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisitorController = void 0;
const api_response_1 = require("../../shared/api-response");
const error_handler_1 = require("../../middlewares/error-handler");
const state_transitions_1 = require("../../shared/state-transitions");
const visitor_service_1 = require("./visitor.service");
class VisitorController {
    static async registerVisitor(req, res, next) {
        try {
            const { guestName, purpose, roomId, tenantId, expectedEntryTime } = req.body;
            const visitor = await visitor_service_1.VisitorService.registerVisitor({
                guestName,
                purpose,
                roomId,
                tenantId,
                expectedEntryTime: expectedEntryTime ? new Date(expectedEntryTime) : undefined,
            });
            return res.status(201).json((0, api_response_1.createResponse)(201, 'Visitor registered', visitor));
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
