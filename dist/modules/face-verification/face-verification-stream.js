"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.faceVerificationStream = void 0;
const MJPEG_BOUNDARY = 'frame';
class FaceVerificationStream {
    subscribers = new Set();
    latestFrame = null;
    writeFrame(res, frame) {
        if (res.writableEnded || !res.writable) {
            this.subscribers.delete(res);
            return;
        }
        try {
            res.write(`--${MJPEG_BOUNDARY}\r\n`);
            res.write('Content-Type: image/jpeg\r\n');
            res.write(`Content-Length: ${frame.length}\r\n\r\n`);
            res.write(frame);
            res.write('\r\n');
        }
        catch {
            this.subscribers.delete(res);
        }
    }
    publish(frame) {
        this.latestFrame = frame;
        for (const subscriber of this.subscribers) {
            this.writeFrame(subscriber, frame);
        }
    }
    subscribe(res) {
        this.subscribers.add(res);
        res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        if (this.latestFrame) {
            this.writeFrame(res, this.latestFrame);
        }
        res.on('close', () => {
            this.subscribers.delete(res);
        });
    }
}
exports.faceVerificationStream = new FaceVerificationStream();
