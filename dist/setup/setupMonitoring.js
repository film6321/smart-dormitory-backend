"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupMonitoring = void 0;
const prom_client_1 = __importDefault(require("prom-client"));
const logger_1 = require("../logger");
const notificationWorker_1 = require("../workers/notificationWorker");
const setupMonitoring = (app) => {
    prom_client_1.default.collectDefaultMetrics({ prefix: 'dormitory_' });
    app.get('/metrics', async (_req, res) => {
        try {
            res.set('Content-Type', prom_client_1.default.register.contentType);
            const metrics = await prom_client_1.default.register.metrics();
            res.status(200).send(metrics);
        }
        catch (error) {
            res.status(500).send(error);
        }
    });
    app.get('/health/notifications', (_req, res) => {
        res.status(200).json({
            success: true,
            data: (0, notificationWorker_1.getNotificationWorkerStats)(),
        });
    });
    logger_1.logger.info('Prometheus monitoring initialized at /metrics');
};
exports.setupMonitoring = setupMonitoring;
