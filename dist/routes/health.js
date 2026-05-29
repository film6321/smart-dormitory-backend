"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../database/db");
const api_response_1 = require("../shared/api-response");
const healthRouter = (0, express_1.Router)();
healthRouter.get('/', async (_req, res) => {
    try {
        await db_1.prisma.$queryRaw `SELECT 1`;
        return res.status(200).json((0, api_response_1.createResponse)(200, 'OK', {
            status: 'healthy',
            timestamp: new Date().toISOString(),
        }));
    }
    catch {
        return res.status(503).json((0, api_response_1.createResponse)(503, 'Service Unavailable', {
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
        }));
    }
});
exports.default = healthRouter;
