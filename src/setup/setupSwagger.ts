import { Express } from 'express';
import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { logger } from '../logger';

export const setupSwagger = (app: Express) => {
  const options = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Smart Dormitory API',
        version: '1.0.0',
        description: 'Smart Dormitory Management System API',
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
    apis: ['./src/modules/**/*.routes.ts'],
  };

  const specs = swaggerJsDoc(options);

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

  logger.info('Swagger API docs initialized at /api-docs');
};
