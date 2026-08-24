import type { Response } from 'express';

const MJPEG_BOUNDARY = 'frame';

class FaceVerificationStream {
  private readonly subscribers = new Set<Response>();
  private latestFrame: Buffer | null = null;

  private writeFrame(res: Response, frame: Buffer) {
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
    } catch {
      this.subscribers.delete(res);
    }
  }

  public publish(frame: Buffer) {
    this.latestFrame = frame;

    for (const subscriber of this.subscribers) {
      this.writeFrame(subscriber, frame);
    }
  }

  public subscribe(res: Response) {
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

export const faceVerificationStream = new FaceVerificationStream();
