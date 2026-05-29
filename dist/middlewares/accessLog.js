"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accessLog = void 0;
const db_1 = require("../database/db");
const logger_1 = require("../logger");
const accessLog = async (req, res, next) => {
    const start = Date.now();
    res.on('finish', async () => {
        const duration = Date.now() - start;
        const log = {
            method: req.method,
            path: req.originalUrl,
            ip: req.ip,
            userId: req.user?.id,
            duration,
        };
        try {
            // Log to console/file
            logger_1.logger.info(log);
            // Persist to DB
            await db_1.prisma.accessLog.create({ data: log });
        }
        catch (error) {
            logger_1.logger.warn({ error }, 'Failed to write access log');
        }
    });
    next();
};
exports.accessLog = accessLog;
