"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupMonitoring = void 0;
const prom_client_1 = __importDefault(require("prom-client"));
const logger_1 = require("../logger");
const notificationWorker_1 = require("../workers/notificationWorker");
const httpRequestsTotal = new prom_client_1.default.Counter({
    name: 'dormitory_http_requests_total',
    help: 'Total HTTP requests handled by the backend',
    labelNames: ['method', 'route', 'status_code'],
});
const httpRequestDuration = new prom_client_1.default.Histogram({
    name: 'dormitory_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});
const setupMonitoring = (app) => {
    prom_client_1.default.collectDefaultMetrics({ prefix: 'dormitory_' });
    app.use((req, res, next) => {
        if (req.path === '/metrics') {
            return next();
        }
        const endTimer = httpRequestDuration.startTimer();
        res.on('finish', () => {
            const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
            const labels = {
                method: req.method,
                route,
                status_code: String(res.statusCode),
            };
            httpRequestsTotal.inc(labels);
            endTimer(labels);
        });
        return next();
    });
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
