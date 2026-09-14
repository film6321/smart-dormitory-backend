"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.send = send;
async function send(provider, _notification) {
    const providerId = provider?.id ?? 'local-stub';
    await new Promise((r) => setTimeout(r, 5));
    try {
        const cfg = provider?.config ? JSON.parse(provider.config) : {};
        if (cfg.shouldFail)
            throw new Error('provider simulated failure');
    }
    catch (error) {
        if (error instanceof Error && error.message === 'provider simulated failure') {
            throw error;
        }
    }
    return { id: `stub-${providerId}-${Date.now()}`, status: 'ok' };
}
exports.default = { send };
