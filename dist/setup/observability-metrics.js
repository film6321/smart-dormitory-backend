"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordFaceVerificationAttempt = exports.recordLoginAttempt = void 0;
const prom_client_1 = __importDefault(require("prom-client"));
const authLoginAttempts = new prom_client_1.default.Counter({
    name: 'dormitory_auth_login_attempts_total',
    help: 'Total login attempts grouped by outcome',
    labelNames: ['outcome'],
});
const faceVerificationAttempts = new prom_client_1.default.Counter({
    name: 'dormitory_face_verification_attempts_total',
    help: 'Total face verification attempts grouped by outcome',
    labelNames: ['outcome'],
});
// Export zero-valued series before the first event so missing metrics remain distinguishable.
for (const outcome of ['success', 'invalid_credentials', 'error']) {
    authLoginAttempts.inc({ outcome }, 0);
}
for (const outcome of ['matched', 'not_matched', 'error']) {
    faceVerificationAttempts.inc({ outcome }, 0);
}
const recordLoginAttempt = (outcome) => {
    authLoginAttempts.inc({ outcome });
};
exports.recordLoginAttempt = recordLoginAttempt;
const recordFaceVerificationAttempt = (outcome) => {
    faceVerificationAttempts.inc({ outcome });
};
exports.recordFaceVerificationAttempt = recordFaceVerificationAttempt;
