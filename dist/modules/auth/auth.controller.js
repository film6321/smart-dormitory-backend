"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const auth_service_1 = require("./auth.service");
const api_response_1 = require("../../shared/api-response");
const presence_1 = require("../../shared/presence");
class AuthController {
    static async login(req, res, next) {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'กรุณากรอกอีเมลและรหัสผ่านให้ครบ'));
            }
            const data = await auth_service_1.AuthService.login(email, password);
            res.cookie('access_token', data.token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: data.sessionTimeoutMinutes * 60 * 1000,
                path: '/',
            });
            return res.status(200).json((0, api_response_1.createResponse)(200, 'เข้าสู่ระบบสำเร็จ', { user: data.user }));
        }
        catch (error) {
            next(error); // โยนเหวี่ยงให้ Middleware Error Catch เป็นคนจัดการ Response
        }
    }
    static async register(req, res, next) {
        try {
            const { email, password, firstName, lastName, role, username } = req.body;
            if (!email || !password) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'กรุณากรอกอีเมลและรหัสผ่านให้ครบ'));
            }
            const data = await auth_service_1.AuthService.register({ email, password, firstName, lastName, role, username });
            return res.status(201).json((0, api_response_1.createResponse)(201, 'สมัครสมาชิกเรียบร้อย', data));
        }
        catch (error) {
            next(error);
        }
    }
    static async heartbeat(req, res, next) {
        try {
            const authedReq = req;
            const userId = authedReq.user?.id;
            if (!userId) {
                return res.status(401).json((0, api_response_1.createResponse)(401, 'Unauthorized'));
            }
            await (0, presence_1.markUserOnline)(userId);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Heartbeat received', { userId, online: true }));
        }
        catch (error) {
            next(error);
        }
    }
    static async logout(req, res, next) {
        try {
            const authedReq = req;
            const userId = authedReq.user?.id;
            if (userId) {
                await (0, presence_1.clearUserOnline)(userId);
            }
            res.clearCookie('access_token', { httpOnly: true, sameSite: 'lax', path: '/' });
            return res.status(200).json((0, api_response_1.createResponse)(200, 'Logged out successfully'));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.AuthController = AuthController;
