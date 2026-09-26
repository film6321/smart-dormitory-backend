"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertSlipAvailable = void 0;
const error_handler_1 = require("../../middlewares/error-handler");
// All payment writers take the same transaction-scoped locks before reserving
// a hash/reference. PostgreSQL releases them on commit/rollback (no TTL race).
const assertSlipAvailable = async (db, slipHash, transactionId, exclude = {}) => {
    const keys = [`payment-slip:hash:${slipHash}`];
    if (transactionId)
        keys.push(`payment-slip:reference:${transactionId}`);
    for (const key of keys.sort()) {
        await db.$queryRaw `SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    }
    const OR = [{ slipHash }, ...(transactionId ? [{ providerTransactionId: transactionId }] : [])];
    const payment = await db.payment.findFirst({
        where: { OR, ...(exclude.paymentId ? { id: { not: exclude.paymentId } } : {}) }, select: { id: true },
    });
    const batch = await db.paymentBatch.findFirst({
        where: { OR, ...(exclude.batchId ? { id: { not: exclude.batchId } } : {}) }, select: { id: true },
    });
    if (transactionId && !payment && !batch) {
        // Older single-bill payments stored the reference only inside providerResponse.
        const legacy = await db.payment.findMany({ where: {
                providerTransactionId: null, providerResponse: { contains: transactionId },
                ...(exclude.paymentId ? { id: { not: exclude.paymentId } } : {}),
            }, select: { providerResponse: true } });
        for (const entry of legacy) {
            let raw;
            try {
                raw = JSON.parse(entry.providerResponse || '{}');
            }
            catch {
                continue;
            }
            if (raw?.rawSlip?.transRef === transactionId)
                throw new error_handler_1.AppError('รายการโอนนี้ถูกใช้ชำระบิลแล้ว', 409);
        }
    }
    if (payment || batch)
        throw new error_handler_1.AppError('สลิปหรือรายการโอนนี้ถูกใช้แล้ว กรุณาตรวจสอบรายการชำระเงิน', 409);
};
exports.assertSlipAvailable = assertSlipAvailable;
