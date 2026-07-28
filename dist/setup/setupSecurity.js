"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSecurity = void 0;
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const helmet_1 = __importDefault(require("helmet"));
const logger_1 = require("../logger");
const rate_limit_store_1 = require("../shared/rate-limit-store");
const setupSecurity = (app) => {
    app.use((0, helmet_1.default)());
    const configuredOrigins = [process.env.FRONTEND_URL, process.env.CORS_ORIGIN].filter(Boolean);
    const nginxHostPort = process.env.NGINX_HOST_PORT || '3002';
    const fallbackOrigins = [
        'http://localhost:3000',
        `http://localhost:${nginxHostPort}`,
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://127.0.0.1:3000',
        `http://127.0.0.1:${nginxHostPort}`,
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:5175',
    ];
    const allowedOrigins = Array.from(new Set([...configuredOrigins, ...fallbackOrigins]));
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }
            callback(new Error('Not allowed by CORS policy'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    app.use(express_1.default.json({ limit: '10mb' }));
    app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
    const generalLimiter = (0, express_rate_limit_1.default)({
        store: (0, rate_limit_store_1.createRateLimitStore)('rl:general:'),
        windowMs: 15 * 60 * 1000,
        max: 100,
        message: { status: 429, message: 'Too many requests from this IP, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use('/api/', generalLimiter);
    logger_1.logger.info('Security middleware initialized');
};
exports.setupSecurity = setupSecurity;
