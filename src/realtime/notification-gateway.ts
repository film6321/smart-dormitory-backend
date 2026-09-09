import { Server, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../shared/env';
import { logger } from '../logger';

export interface RealtimeNotification {
  id: number;
  userId?: number | null;
  tenantId?: number | null;
  type: string;
  channel: string;
  payload?: string | null;
  status: string;
  createdAt: Date | string;
}

let realtimeServer: Server | undefined;
type UserRoomResolver = (userId: number) => Promise<string | undefined>;

const getCookieValue = (cookieHeader: string | undefined, name: string) => (
  cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
);

const getSocketToken = (socket: Socket) => {
  const authToken = socket.handshake.auth?.token;
  return typeof authToken === 'string' && authToken ? authToken : getCookieValue(socket.handshake.headers.cookie, 'access_token');
};

export const initializeNotificationGateway = (httpServer: HttpServer, resolveUserRoom?: UserRoomResolver) => {
  realtimeServer = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  realtimeServer.use((socket, next) => {
    const token = getSocketToken(socket);
    if (!token) {
      next(new Error('Authentication required'));
      return;
    }

    try {
      socket.data.user = jwt.verify(token, getJwtSecret()) as { id: number; role: string };
      next();
    } catch {
      next(new Error('Invalid authentication token'));
    }
  });

  realtimeServer.on('connection', (socket) => {
    const user = socket.data.user as { id: number; role: string };
    socket.join(`user:${user.id}`);
    if (user.role === 'ADMIN') {
      socket.join('admins');
    }
    logger.info({ userId: user.id, role: user.role, rooms: user.role === 'ADMIN' ? ['admins', `user:${user.id}`] : [`user:${user.id}`] }, 'Realtime client connected');

    socket.on('joinRoom', async (room: unknown) => {
      if (typeof room !== 'string' || !/^(admins|room:[a-zA-Z0-9-]+)$/.test(room)) {
        return;
      }
      if (room === 'admins' && user.role !== 'ADMIN') {
        return;
      }
      if (room.startsWith('room:') && user.role !== 'ADMIN') {
        const roomNumber = await resolveUserRoom?.(user.id);
        if (!roomNumber || room !== `room:${roomNumber}`) {
          return;
        }
      }
      socket.join(room);
    });

    socket.on('leaveRoom', (room: unknown) => {
      if (typeof room === 'string') {
        void socket.leave(room);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ userId: user.id, reason }, 'Realtime client disconnected');
    });
  });

  return realtimeServer;
};

export const publishNotificationAlert = (notification: RealtimeNotification) => {
  if (!realtimeServer) {
    return;
  }

  realtimeServer.to('admins').emit('notificationAlert', {
    schemaVersion: 1,
    id: notification.id,
    type: notification.type,
    channel: notification.channel,
    status: notification.status,
    payload: notification.payload,
    createdAt: notification.createdAt,
  });
};

export const publishAdminAlert = (id: number, type: string, message: string, status = 'PENDING') => {
  publishNotificationAlert({
    id,
    type,
    channel: 'IN_APP',
    status,
    payload: JSON.stringify({ message }),
    createdAt: new Date(),
  });
};

export const closeNotificationGateway = async () => {
  if (!realtimeServer) {
    return;
  }
  await realtimeServer.close();
  realtimeServer = undefined;
};