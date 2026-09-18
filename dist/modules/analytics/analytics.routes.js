"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_jwt_1 = require("../../middlewares/auth-jwt");
const analytics_controller_1 = require("./analytics.controller");
const router = (0, express_1.Router)();
router.get('/dashboard', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), analytics_controller_1.AnalyticsController.getDashboardAnalytics);
router.get('/metrics/raw', auth_jwt_1.verifyToken, (0, auth_jwt_1.requireRole)(['ADMIN']), analytics_controller_1.AnalyticsController.getPrometheusMetrics);
exports.default = router;
