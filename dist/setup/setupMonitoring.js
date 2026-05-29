"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupMonitoring = void 0;
const prom_client_1 = __importDefault(require("prom-client"));
const setupMonitoring = (app) => {
    // บันทึกสถิติขั้นพื้นฐานของ Node (RAM, CPU, Request)
    const collectDefaultMetrics = prom_client_1.default.collectDefaultMetrics;
    collectDefaultMetrics({ prefix: 'dormitory_' });
    // แขวนป้ายบอกทางให้โปรแกรมภายนอกเข้ามารับค่า
    app.get('/metrics', async (req, res) => {
        try {
            res.set('Content-Type', prom_client_1.default.register.contentType);
            const metrics = await prom_client_1.default.register.metrics();
            res.status(200).send(metrics);
        }
        catch (ex) {
            res.status(500).send(ex);
        }
    });
    console.log('✅ Prometheus Monitoring Initialized at /metrics');
};
exports.setupMonitoring = setupMonitoring;
