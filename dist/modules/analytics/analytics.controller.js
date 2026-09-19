"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsController = void 0;
const api_response_1 = require("../../shared/api-response");
const analytics_service_1 = require("./analytics.service");
class AnalyticsController {
    static async getDashboardAnalytics(req, res, next) {
        try {
            const analytics = await analytics_service_1.AnalyticsService.getDashboardAnalytics();
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Dashboard analytics retrieved successfully', analytics));
        }
        catch (error) {
            next(error);
        }
    }
    static async getPrometheusMetrics(req, res, next) {
        try {
            const rawMetrics = await analytics_service_1.AnalyticsService.getPrometheusMetricsRaw();
            res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            return res.status(200).send(rawMetrics);
        }
        catch (error) {
            next(error);
        }
    }
    static async getObservabilityAnalytics(req, res, next) {
        try {
            const analytics = await analytics_service_1.AnalyticsService.getObservabilityAnalytics();
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Observability analytics retrieved successfully', analytics));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.AnalyticsController = AnalyticsController;
