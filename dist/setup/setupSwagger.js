"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSwagger = void 0;
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const setupSwagger = (app) => {
    const options = {
        definition: {
            openapi: '3.0.0',
            info: {
                title: 'Smart Dormitory API',
                version: '1.0.0',
                description: 'ระบบจัดการหอพักอัจฉริยะ (Modular Monolith Blueprint)',
            },
            servers: [{ url: 'http://localhost:3000' }],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                    },
                },
            },
        },
        // สแกนไฟล์ Route ทั้งหมดเพื่อสร้างเอกสาร
        apis: ['./src/modules/**/*.routes.ts'],
    };
    const specs = (0, swagger_jsdoc_1.default)(options);
    // เปิดหน้าให้ทีมเข้ามาอ่านสเปค API
    app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(specs));
    console.log('✅ Swagger API Docs Initialized at /api-docs');
};
exports.setupSwagger = setupSwagger;
