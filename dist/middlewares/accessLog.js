"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accessLog = void 0;
const db_1 = require("../database/db");
const logger_1 = require("../logger");
const accessLogQueue_1 = require("../workers/accessLogQueue");
const ignoredPaths = ['/health', '/api/health', '/metrics'];
const shouldSkipAccessLog = (path) => ignoredPaths.some((ignoredPath) => path.startsWith(ignoredPath));
const persistAccessLogFallback = async (log) => {
    try {
        await db_1.prisma.accessLog.create({
            data: {
                method: log.method,
                path: log.path,
                ip: log.ip,
                userId: log.userId,
                duration: log.duration,
                createdAt: new Date(log.createdAt),
            },
        });
    }
    catch (error) {
        logger_1.logger.warn({ error }, 'Failed to persist access log fallback');
    }
};
const accessLog = (req, res, next) => {
    if (shouldSkipAccessLog(req.path)) {
        next();
        return;
    }
    const start = Date.now();
    res.on('finish', () => {
        const log = {
            method: req.method,
            path: req.originalUrl,
            ip: req.ip,
            userId: req.user?.id,
            duration: Date.now() - start,
            createdAt: new Date().toISOString(),
        };
        logger_1.logger.info(log);
        void (0, accessLogQueue_1.enqueueAccessLog)(log).catch((error) => {
            logger_1.logger.warn({ error }, 'Failed to enqueue access log, writing directly to database');
            void persistAccessLogFallback(log);
        });
    });
    next();
};
exports.accessLog = accessLog;
