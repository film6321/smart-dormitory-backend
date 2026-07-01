"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
// Load environment variables early
dotenv_1.default.config({ path: path_1.default.join(process.cwd(), '.env') });
// Setup pattern imports
const setupMonitoring_1 = require("./setup/setupMonitoring");
const setupSecurity_1 = require("./setup/setupSecurity");
const setupSwagger_1 = require("./setup/setupSwagger");
// Route imports
const accessLog_1 = require("./middlewares/accessLog");
const error_handler_1 = require("./middlewares/error-handler");
const auth_routes_1 = __importDefault(require("./modules/auth/auth.routes"));
const ocr_routes_1 = __importDefault(require("./modules/ocr/ocr.routes"));
const users_routes_1 = __importDefault(require("./modules/users/users.routes"));
const billing_routes_1 = __importDefault(require("./modules/billing/billing.routes"));
const maintenance_routes_1 = __importDefault(require("./modules/maintenance/maintenance.routes"));
const visitor_routes_1 = __importDefault(require("./modules/visitor/visitor.routes"));
const health_1 = __importDefault(require("./routes/health"));
const app = (0, express_1.default)();
// Initialize system components
(0, setupSecurity_1.setupSecurity)(app);
(0, setupMonitoring_1.setupMonitoring)(app);
(0, setupSwagger_1.setupSwagger)(app);
// API routes
app.use(accessLog_1.accessLog);
app.use('/health', health_1.default);
app.use('/api/auth', auth_routes_1.default);
app.use('/api/ocr', ocr_routes_1.default);
app.use('/api/users', users_routes_1.default);
app.use('/api/billing', billing_routes_1.default);
app.use('/api/maintenance', maintenance_routes_1.default);
app.use('/api/visitor', visitor_routes_1.default);
// Temporary health check for /api prefix
app.get('/api/ping', (_req, res) => res.status(200).send('pong'));
// Error handling
app.use(error_handler_1.errorHandler);
exports.default = app;
