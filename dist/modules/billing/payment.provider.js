"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentProviderClient = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
const normalizeBaseUrl = (url) => url.replace(/\/+$/, '');
const getTimeoutMs = () => {
    const configured = Number(process.env.PAYMENT_API_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
};
const getPaymentApiUrl = () => {
    const configured = process.env.PAYMENT_API_URL?.trim();
    if (!configured) {
        throw new error_handler_1.AppError('Payment Gateway is not configured. Please contact the administrator.', 503);
    }
    return normalizeBaseUrl(configured);
};
const fetchWithTimeout = async (url, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    catch (error) {
        throw new error_handler_1.AppError(error instanceof Error && error.name === 'AbortError'
            ? 'Payment Gateway timed out. Please try again later.'
            : 'Payment Gateway is unavailable. Please try again later.', 503);
    }
    finally {
        clearTimeout(timeout);
    }
};
const parseAmount = (value) => {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '')
        return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
};
const normalizeResponse = (payload) => {
    const matchedAccount = payload.matchedAccount ?? payload.data?.matchedAccount;
    const rawAmount = payload.data?.rawSlip?.amount?.amount;
    return {
        success: payload.success === true && payload.data?.isDuplicate === false,
        recipientMatched: typeof matchedAccount === 'object' && matchedAccount !== null && !Array.isArray(matchedAccount) && Object.keys(matchedAccount).length > 0,
        duplicate: payload.data?.isDuplicate === true,
        amount: parseAmount(rawAmount),
        rawData: payload.data ?? payload,
        transactionId: typeof payload.data?.rawSlip?.transRef === 'string' ? payload.data.rawSlip.transRef.trim() || undefined : undefined,
        message: payload.message || payload.error,
    };
};
class PaymentProviderClient {
    static async generateQr(amount) {
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new error_handler_1.AppError('Payment amount must be greater than zero', 400);
        }
        const response = await fetchWithTimeout(`${getPaymentApiUrl()}/qrcode?amount=${encodeURIComponent(amount.toFixed(2))}`, { method: 'GET' });
        if (!response.ok) {
            throw new error_handler_1.AppError('Payment Gateway could not generate the QR code. Please try again later.', 503);
        }
        return Buffer.from(await response.arrayBuffer());
    }
    static async verifySlip(file) {
        const formData = new FormData();
        const imageBytes = new Uint8Array(file.buffer.length);
        imageBytes.set(file.buffer);
        formData.append('image', new Blob([imageBytes.buffer], { type: file.mimetype || 'application/octet-stream' }), file.originalname || 'slip.jpg');
        const response = await fetchWithTimeout(`${getPaymentApiUrl()}/upload`, {
            method: 'POST',
            body: formData,
        });
        const payload = (await response.json().catch(() => null));
        if (!payload) {
            throw new error_handler_1.AppError('Payment Gateway returned an invalid response. Please try again later.', 503);
        }
        if (response.status >= 500) {
            throw new error_handler_1.AppError('Payment Gateway is unavailable. Please try again later.', 503);
        }
        const result = normalizeResponse(payload);
        return { ...result, success: response.ok && result.success };
    }
}
exports.PaymentProviderClient = PaymentProviderClient;
