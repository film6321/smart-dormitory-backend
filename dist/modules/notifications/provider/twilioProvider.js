"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.send = send;
const https_1 = __importDefault(require("https"));
async function send(provider, notification) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    if (!accountSid || !authToken || !fromNumber || !notification.recipientPhone) {
        const { send: fallbackSend } = await Promise.resolve().then(() => __importStar(require('./simpleProvider')));
        return fallbackSend(provider, notification);
    }
    const body = typeof notification.body === 'string' ? notification.body : JSON.stringify(notification.body ?? {});
    const data = new URLSearchParams({
        To: notification.recipientPhone,
        From: fromNumber,
        Body: body,
    });
    const options = {
        hostname: 'api.twilio.com',
        port: 443,
        path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
        method: 'POST',
        auth: `${accountSid}:${authToken}`,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(data.toString()),
        },
    };
    const providerMessageId = `twilio-${Date.now()}`;
    return new Promise((resolve, reject) => {
        const req = https_1.default.request(options, (res) => {
            let raw = '';
            res.on('data', (chunk) => {
                raw += chunk;
            });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ id: providerMessageId, status: 'queued', raw, provider: 'twilio' });
                }
                else {
                    reject(new Error(`Twilio request failed with ${res.statusCode}: ${raw}`));
                }
            });
        });
        req.on('error', reject);
        req.write(data.toString());
        req.end();
    });
}
exports.default = { send };
