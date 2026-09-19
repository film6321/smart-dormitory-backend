"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.faceVerificationMonitoringBus = void 0;
const events_1 = require("events");
const DEVICE_OFFLINE_AFTER_MS = 30_000;
const MAX_SCAN_HISTORY = 25;
class FaceVerificationMonitoringBus {
    emitter = new events_1.EventEmitter();
    clients = new Set();
    scanHistory = [];
    devices = new Map();
    constructor() {
        this.emitter.setMaxListeners(0);
    }
    nowIso() {
        return new Date().toISOString();
    }
    normalizeDeviceCode(deviceCode) {
        const code = deviceCode?.trim();
        return code ? code : null;
    }
    snapshotDevice(deviceCode) {
        const existing = this.devices.get(deviceCode);
        if (!existing) {
            const created = {
                device_code: deviceCode,
                status: 'OFFLINE',
                last_seen: this.nowIso(),
                last_frame_at: null,
            };
            this.devices.set(deviceCode, created);
            return created;
        }
        return existing;
    }
    refreshDeviceStatus(device) {
        const lastSeenAt = Date.parse(device.last_seen);
        const isOnline = Number.isFinite(lastSeenAt) && Date.now() - lastSeenAt <= DEVICE_OFFLINE_AFTER_MS;
        return {
            ...device,
            status: isOnline ? 'ONLINE' : 'OFFLINE',
        };
    }
    emitEvent(eventName, payload) {
        const message = `event: ${String(eventName)}\ndata: ${JSON.stringify(payload)}\n\n`;
        for (const client of this.clients) {
            client.write(message);
        }
        this.emitter.emit(String(eventName), payload);
    }
    subscribe(res) {
        this.clients.add(res);
        res.write('retry: 3000\n\n');
        res.write(`event: snapshot\ndata: ${JSON.stringify(this.getSnapshot())}\n\n`);
        res.on('close', () => {
            this.clients.delete(res);
        });
    }
    recordHeartbeat(deviceCode) {
        const normalized = this.normalizeDeviceCode(deviceCode);
        if (!normalized) {
            return null;
        }
        const current = this.snapshotDevice(normalized);
        const updated = {
            ...current,
            status: 'ONLINE',
            last_seen: this.nowIso(),
        };
        this.devices.set(normalized, updated);
        const snapshot = this.refreshDeviceStatus(updated);
        this.emitEvent('heartbeat', snapshot);
        return snapshot;
    }
    recordLiveFrame(deviceCode) {
        const normalized = this.normalizeDeviceCode(deviceCode);
        if (!normalized) {
            return null;
        }
        const current = this.snapshotDevice(normalized);
        const updated = {
            ...current,
            status: 'ONLINE',
            last_seen: this.nowIso(),
            last_frame_at: this.nowIso(),
        };
        this.devices.set(normalized, updated);
        const payload = {
            device_code: normalized,
            image_url: '/live/feed.jpg',
            updated_at: updated.last_frame_at ?? this.nowIso(),
        };
        this.emitEvent('live_frame', payload);
        return payload;
    }
    recordScan(scan) {
        this.scanHistory.unshift(scan);
        if (this.scanHistory.length > MAX_SCAN_HISTORY) {
            this.scanHistory.length = MAX_SCAN_HISTORY;
        }
        if (scan.device_code) {
            const current = this.snapshotDevice(scan.device_code);
            this.devices.set(scan.device_code, {
                ...current,
                status: 'ONLINE',
                last_seen: this.nowIso(),
            });
        }
        this.emitEvent('scan', scan);
    }
    getSnapshot() {
        const devices = Array.from(this.devices.values()).map((device) => this.refreshDeviceStatus(device));
        return {
            devices,
            scans: [...this.scanHistory],
        };
    }
    getDevices() {
        return this.getSnapshot().devices;
    }
    getScanHistory() {
        return [...this.scanHistory];
    }
    clearScanHistory() {
        this.scanHistory.length = 0;
        this.emitEvent('snapshot', this.getSnapshot());
    }
}
exports.faceVerificationMonitoringBus = new FaceVerificationMonitoringBus();
