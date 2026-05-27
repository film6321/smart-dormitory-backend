import { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerJsDoc from 'swagger-jsdoc';

export const setupSwagger = (app: Express) => {
  const options = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Smart Dormitory API',
        version: '1.0.0',
        description: 'ระบบจัดการหอพักอัจฉริยะ (Modular Monolith Blueprint)',
      },
      servers: [{ url: 'http://localhost:3000' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    // สแกนไฟล์ Route ทั้งหมดเพื่อสร้างเอกสาร
    apis: ['./src/modules/**/*.routes.ts'],
  };

  const specs = swaggerJsDoc(options);
  
  // เปิดหน้าให้ทีมเข้ามาอ่านสเปค API
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
  
  console.log('✅ Swagger API Docs Initialized at /api-docs');
};
