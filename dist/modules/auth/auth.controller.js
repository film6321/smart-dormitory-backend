"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const auth_service_1 = require("./auth.service");
const api_response_1 = require("../../shared/api-response");
class AuthController {
    static async login(req, res, next) {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'กรุณากรอกอีเมลและรหัสผ่านให้ครบ'));
            }
            const data = await auth_service_1.AuthService.login(email, password);
            return res.status(200).json((0, api_response_1.createResponse)(200, 'เข้าสู่ระบบสำเร็จ', data));
        }
        catch (error) {
            next(error); // โยนเหวี่ยงให้ Middleware Error Catch เป็นคนจัดการ Response
        }
    }
    static async register(req, res, next) {
        try {
            const { email, password, firstName, lastName, role } = req.body;
            if (!email || !password) {
                return res.status(400).json((0, api_response_1.createResponse)(400, 'กรุณากรอกอีเมลและรหัสผ่านให้ครบ'));
            }
            const data = await auth_service_1.AuthService.register({ email, password, firstName, lastName, role });
            return res.status(201).json((0, api_response_1.createResponse)(201, 'สมัครสมาชิกเรียบร้อย', data));
        }
        catch (error) {
            next(error);
        }
    }
}
exports.AuthController = AuthController;
