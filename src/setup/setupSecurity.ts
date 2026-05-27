import cors from 'cors';
import express, { Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

export const setupSecurity = (app: Express) => {
  // เปิดระบบป้องกัน HTTP Headers
  app.use(helmet());
  
  // ตั้งค่า CORS ให้รับเฉพาะจาก Frontend URL ที่อนุญาต
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:5173'
  ];
  
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS policy'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  
  // แปลงข้อมูลที่ส่งมาเป็น JSON
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // ตั้งค่า Rate Limiter ทั่วไป (ป้องกัน DoS/DDoS)
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100,
    message: { status: 429, message: 'Too many requests from this IP, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  
  app.use('/api/', generalLimiter);
  
  console.log('✅ Security Middleware Initialized');
};
