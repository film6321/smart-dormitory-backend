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
const setupSecurity = (app) => {
    // เปิดระบบป้องกัน HTTP Headers
    app.use((0, helmet_1.default)());
    // ตั้งค่า CORS ให้รับเฉพาะจาก Frontend URL ที่อนุญาต
    const allowedOrigins = [
        process.env.FRONTEND_URL || 'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:5173'
    ];
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            }
            else {
                callback(new Error('Not allowed by CORS policy'));
            }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));
    // แปลงข้อมูลที่ส่งมาเป็น JSON
    app.use(express_1.default.json({ limit: '10mb' }));
    app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
    // ตั้งค่า Rate Limiter ทั่วไป (ป้องกัน DoS/DDoS)
    const generalLimiter = (0, express_rate_limit_1.default)({
        windowMs: 15 * 60 * 1000,
        max: 100,
        message: { status: 429, message: 'Too many requests from this IP, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use('/api/', generalLimiter);
    console.log('✅ Security Middleware Initialized');
};
exports.setupSecurity = setupSecurity;
