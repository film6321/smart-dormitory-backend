"use strict";
// Simple provider stub that simulates sending SMS/Email
// Keeps implementation intentionally minimal for tests and local runs.
Object.defineProperty(exports, "__esModule", { value: true });
exports.send = send;
async function send(provider, notification) {
    // If no provider configured, simulate success with a generated id
    const providerId = provider?.id ?? 'local-stub';
    // Simulate network latency
    await new Promise((r) => setTimeout(r, 5));
    // For failure simulation, provider config can include {shouldFail: true} in JSON stored in provider.config
    try {
        const cfg = provider?.config ? JSON.parse(provider.config) : {};
        if (cfg.shouldFail)
            throw new Error('provider simulated failure');
    }
    catch (e) {
        // ignore JSON parse errors and treat as success
    }
    return { id: `stub-${providerId}-${Date.now()}`, status: 'ok' };
}
exports.default = { send };
