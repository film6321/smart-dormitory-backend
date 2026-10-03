import type { Response } from 'express';
import { EventEmitter } from 'events';
import { publishRealtimeEvent } from '../../realtime/notification-gateway';

export type CameraDeviceStatus = 'ONLINE' | 'OFFLINE';

export interface CameraDeviceSnapshot {
  device_code: string;
  status: CameraDeviceStatus;
  last_seen: string;
  last_frame_at: string | null;
}

export interface CameraScanSnapshot {
  id: string;
  student_code: string;
  direction: 'IN' | 'OUT';
  confidence: number;
  scanned_at: string;
  device_code?: string;
  action?: string;
  activity_type?: 'FACE_SCAN' | 'DOOR';
  door_trigger?: 'MANUAL' | 'AUTO';
  student?: {
    code: string;
    name: string;
    room: string;
  };
}

export interface CameraLiveFrameSnapshot {
  device_code: string;
  image_url: string;
  updated_at: string;
}

type CameraEventPayloads = {
  snapshot: {
    devices: CameraDeviceSnapshot[];
    scans: CameraScanSnapshot[];
  };
  scan: CameraScanSnapshot;
  heartbeat: CameraDeviceSnapshot;
  live_frame: CameraLiveFrameSnapshot;
};

const DEVICE_OFFLINE_AFTER_MS = 30_000;
const MAX_SCAN_HISTORY = 25;

class FaceVerificationMonitoringBus {
  private readonly emitter = new EventEmitter();
  private readonly clients = new Set<Response>();
  private readonly scanHistory: CameraScanSnapshot[] = [];
  private readonly devices = new Map<string, CameraDeviceSnapshot>();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private normalizeDeviceCode(deviceCode?: string): string | null {
    const code = deviceCode?.trim();
    return code ? code : null;
  }

  private snapshotDevice(deviceCode: string): CameraDeviceSnapshot {
    const existing = this.devices.get(deviceCode);
    if (!existing) {
      const created: CameraDeviceSnapshot = {
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

  private refreshDeviceStatus(device: CameraDeviceSnapshot): CameraDeviceSnapshot {
    const lastSeenAt = Date.parse(device.last_seen);
    const isOnline = Number.isFinite(lastSeenAt) && Date.now() - lastSeenAt <= DEVICE_OFFLINE_AFTER_MS;

    return {
      ...device,
      status: isOnline ? 'ONLINE' : 'OFFLINE',
    };
  }

  private emitEvent<K extends keyof CameraEventPayloads>(eventName: K, payload: CameraEventPayloads[K]) {
    const message = `event: ${String(eventName)}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of this.clients) {
      client.write(message);
    }

    this.emitter.emit(String(eventName), payload);
  }

  public subscribe(res: Response) {
    this.clients.add(res);

    res.write('retry: 3000\n\n');
    res.write(
      `event: snapshot\ndata: ${JSON.stringify(this.getSnapshot())}\n\n`,
    );

    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  public recordHeartbeat(deviceCode?: string): CameraDeviceSnapshot | null {
    const normalized = this.normalizeDeviceCode(deviceCode);
    if (!normalized) {
      return null;
    }

    const current = this.snapshotDevice(normalized);
    const updated: CameraDeviceSnapshot = {
      ...current,
      status: 'ONLINE',
      last_seen: this.nowIso(),
    };

    this.devices.set(normalized, updated);
    const snapshot = this.refreshDeviceStatus(updated);
    this.emitEvent('heartbeat', snapshot);
    return snapshot;
  }

  public recordLiveFrame(deviceCode?: string): CameraLiveFrameSnapshot | null {
    const normalized = this.normalizeDeviceCode(deviceCode);
    if (!normalized) {
      return null;
    }

    const current = this.snapshotDevice(normalized);
    const updated: CameraDeviceSnapshot = {
      ...current,
      status: 'ONLINE',
      last_seen: this.nowIso(),
      last_frame_at: this.nowIso(),
    };

    this.devices.set(normalized, updated);

    const payload: CameraLiveFrameSnapshot = {
      device_code: normalized,
      image_url: '/live/feed.jpg',
      updated_at: updated.last_frame_at ?? this.nowIso(),
    };

    this.emitEvent('live_frame', payload);
    return payload;
  }

  public recordScan(scan: CameraScanSnapshot) {
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
    if (scan.activity_type === 'FACE_SCAN' || scan.activity_type === 'DOOR') {
      publishRealtimeEvent('faceGateActivity', scan);
    }
  }

  public recordDoorAction(event: CameraScanSnapshot) {
    this.recordScan({ ...event, activity_type: 'DOOR' });
  }

  public getSnapshot() {
    const devices = Array.from(this.devices.values()).map((device) => this.refreshDeviceStatus(device));

    return {
      devices,
      scans: [...this.scanHistory],
    };
  }

  public getDevices() {
    return this.getSnapshot().devices;
  }

  public getScanHistory() {
    return [...this.scanHistory];
  }

  public clearScanHistory() {
    this.scanHistory.length = 0;
    this.emitEvent('snapshot', this.getSnapshot());
  }
}

export const faceVerificationMonitoringBus = new FaceVerificationMonitoringBus();
