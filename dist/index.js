"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const app_1 = __importDefault(require("./app"));
const db_1 = require("./database/db");
const logger_1 = require("./logger");
const redis_1 = require("./shared/redis");
const accessLogQueue_1 = require("./workers/accessLogQueue");
const ocrJobWorker_1 = require("./workers/ocrJobWorker");
const notificationWorker_1 = require("./workers/notificationWorker");
const notification_gateway_1 = require("./realtime/notification-gateway");
const PORT = process.env.PORT || 3000;
const server = http_1.default.createServer(app_1.default);
(0, notification_gateway_1.initializeNotificationGateway)(server, async (userId) => {
    const tenant = await db_1.prisma.tenant.findUnique({
        where: { userId },
        include: { room: { select: { roomNumber: true } } },
    });
    return tenant?.room?.roomNumber;
});
server.listen(PORT, () => {
    (0, accessLogQueue_1.startAccessLogWorker)();
    (0, ocrJobWorker_1.startOcrJobWorker)();
    (0, notificationWorker_1.startNotificationWorker)();
    logger_1.logger.info(`Backend API Gateway is running on http://localhost:${PORT}`);
});
const shutdown = async (signal) => {
    logger_1.logger.info(`Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
        await (0, ocrJobWorker_1.stopOcrJobWorker)();
        await (0, accessLogQueue_1.stopAccessLogWorker)();
        await (0, notificationWorker_1.stopNotificationWorker)();
        await (0, notification_gateway_1.closeNotificationGateway)();
        await (0, redis_1.disconnectRedis)();
        await db_1.prisma.$disconnect();
        logger_1.logger.info('HTTP server, Redis, and database connections closed.');
        process.exit(0);
    });
};
process.on('SIGINT', () => {
    void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});
