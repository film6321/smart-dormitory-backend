"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeNotificationGateway = exports.publishAdminAlert = exports.publishNotificationAlert = exports.initializeNotificationGateway = void 0;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../shared/env");
const logger_1 = require("../logger");
let realtimeServer;
const getCookieValue = (cookieHeader, name) => (cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1));
const getSocketToken = (socket) => {
    const authToken = socket.handshake.auth?.token;
    return typeof authToken === 'string' && authToken ? authToken : getCookieValue(socket.handshake.headers.cookie, 'access_token');
};
const initializeNotificationGateway = (httpServer, resolveUserRoom) => {
    realtimeServer = new socket_io_1.Server(httpServer, {
        cors: { origin: true, credentials: true },
    });
    realtimeServer.use((socket, next) => {
        const token = getSocketToken(socket);
        if (!token) {
            next(new Error('Authentication required'));
            return;
        }
        try {
            socket.data.user = jsonwebtoken_1.default.verify(token, (0, env_1.getJwtSecret)());
            next();
        }
        catch {
            next(new Error('Invalid authentication token'));
        }
    });
    realtimeServer.on('connection', (socket) => {
        const user = socket.data.user;
        socket.join(`user:${user.id}`);
        if (user.role === 'ADMIN') {
            socket.join('admins');
        }
        logger_1.logger.info({ userId: user.id, role: user.role, rooms: user.role === 'ADMIN' ? ['admins', `user:${user.id}`] : [`user:${user.id}`] }, 'Realtime client connected');
        socket.on('joinRoom', async (room) => {
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
        socket.on('leaveRoom', (room) => {
            if (typeof room === 'string') {
                void socket.leave(room);
            }
        });
        socket.on('disconnect', (reason) => {
            logger_1.logger.debug({ userId: user.id, reason }, 'Realtime client disconnected');
        });
    });
    return realtimeServer;
};
exports.initializeNotificationGateway = initializeNotificationGateway;
const publishNotificationAlert = (notification) => {
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
exports.publishNotificationAlert = publishNotificationAlert;
const publishAdminAlert = (id, type, message, status = 'PENDING') => {
    (0, exports.publishNotificationAlert)({
        id,
        type,
        channel: 'IN_APP',
        status,
        payload: JSON.stringify({ message }),
        createdAt: new Date(),
    });
};
exports.publishAdminAlert = publishAdminAlert;
const closeNotificationGateway = async () => {
    if (!realtimeServer) {
        return;
    }
    await realtimeServer.close();
    realtimeServer = undefined;
};
exports.closeNotificationGateway = closeNotificationGateway;
