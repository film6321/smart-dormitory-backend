import { Server, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../shared/env';
import { logger } from '../logger';
import { clearUserOnline, listOnlineUserIds, markUserOnline } from '../shared/presence';

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

export interface UserPresencePayload {
  userId: number;
  isOnline: boolean;
  lastSeenAt?: string;
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

    void (async () => {
      try {
        await markUserOnline(user.id);
        publishUserPresence(user.id, true);

        if (user.role === 'ADMIN') {
          const onlineIds = await listOnlineUserIds();
          socket.emit('users:online', onlineIds);
        }
      } catch (err) {
        logger.warn({ error: err, userId: user.id }, 'Failed to mark user online in realtime gateway');
      }
    })();

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

    socket.on('requestTelemetry', async () => {
      if (user.role === 'ADMIN') {
        const mem = process.memoryUsage();
        socket.emit('system:telemetry', {
          uptimeSeconds: Math.floor(process.uptime()),
          memoryUsageMb: {
            rss: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
            heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
            heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
            external: Math.round((mem.external / 1024 / 1024) * 100) / 100,
          },
          timestamp: new Date().toISOString(),
        });
      }
    });

    socket.on('requestOnlineUsers', async () => {
      if (user.role === 'ADMIN') {
        const onlineIds = await listOnlineUserIds();
        socket.emit('users:online', onlineIds);
      }
    });

    socket.on('disconnect', async (reason) => {
      logger.debug({ userId: user.id, reason }, 'Realtime client disconnected');
      try {
        await clearUserPresenceWhenDisconnected(user.id);
      } catch (err) {
        logger.warn({ error: err, userId: user.id }, 'Failed to clear user presence on disconnect');
      }
    });
  });

  return realtimeServer;
};

export const publishAnalyticsTelemetry = (telemetry: unknown) => {
  if (!realtimeServer) {
    return;
  }
  realtimeServer.to('admins').emit('system:telemetry', telemetry);
};

export const publishRealtimeEvent = (eventName: string, payload: unknown) => {
  if (!realtimeServer) {
    return;
  }
  realtimeServer.to('admins').emit(eventName, payload);
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

  const upperType = notification.type.toUpperCase();
  if (upperType.includes('BILL')) {
    realtimeServer.to('admins').emit('billStatusUpdated', notification);
  } else if (upperType.includes('MAINTENANCE')) {
    realtimeServer.to('admins').emit('maintenanceStatusUpdated', notification);
  } else if (upperType.includes('VISITOR')) {
    realtimeServer.to('admins').emit('visitorStatusUpdated', notification);
    realtimeServer.to('admins').emit('visitorScanEvent', notification);
  } else if (upperType.includes('TENANT') || upperType.includes('STUDENT')) {
    realtimeServer.to('admins').emit('tenantStatusUpdated', notification);
  } else if (upperType.includes('USER')) {
    realtimeServer.to('admins').emit('userStatusUpdated', notification);
  }
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

export const publishUserPresence = (userId: number, isOnline: boolean, lastSeenAt?: string) => {
  if (!realtimeServer) {
    return;
  }
  const payload: UserPresencePayload = {
    userId,
    isOnline,
    lastSeenAt: lastSeenAt ?? new Date().toISOString(),
  };
  realtimeServer.to('admins').emit('user:presence', payload);
};

export const clearUserPresenceWhenDisconnected = async (userId: number): Promise<boolean> => {
  if (realtimeServer) {
    const userSockets = await realtimeServer.in(`user:${userId}`).fetchSockets();
    if (userSockets.length > 0) {
      return false;
    }
  }

  const now = new Date();
  await clearUserOnline(userId);
  publishUserPresence(userId, false, now.toISOString());
  return true;
};

export const closeNotificationGateway = async () => {
  if (!realtimeServer) {
    return;
  }
  await realtimeServer.close();
  realtimeServer = undefined;
};
