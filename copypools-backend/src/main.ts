import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import helmet from 'helmet';
import compression from 'compression';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  }));

  // Compression
  app.use(compression());

  // Enable CORS for frontend
  const corsOrigins = process.env.CORS_ORIGIN?.split(',') || [
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:5174'
  ];

  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? corsOrigins
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter for structured error responses
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global logging interceptor
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Swagger Configuration with enhanced documentation
  const config = new DocumentBuilder()
    .setTitle('CopyPools Backend API')
    .setDescription(`
      API for managing Uniswap V4 liquidity positions with auto-compounding and range management.
      
      ## Features
      - Position management (create, read, update, close)
      - Range adjustment
      - Fee compounding
      - Historical event tracking via Ponder indexer
      - Real-time blockchain synchronization
      
      ## Authentication
      Currently, the API does not require authentication. All endpoints are publicly accessible.
      
      ## Rate Limiting
      API requests are rate-limited to 100 requests per minute per IP address.
      
      ## Error Responses
      All errors follow a consistent format:
      \`\`\`json
      {
        "statusCode": 400,
        "timestamp": "2025-01-20T10:00:00.000Z",
        "path": "/positions/1",
        "method": "GET",
        "error": "Error message"
      }
      \`\`\`
    `)
    .setVersion('1.0')
    .addTag('positions', 'Liquidity position management endpoints')
    .addTag('health', 'System health and status endpoints')
    .addServer('http://localhost:3000', 'Local development server')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
    },
  });

  const port = process.env.PORT ?? 3000;

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.log('SIGTERM signal received: closing HTTP server');
    await app.close();
    logger.log('HTTP server closed');
  });

  process.on('SIGINT', async () => {
    logger.log('SIGINT signal received: closing HTTP server');
    await app.close();
    logger.log('HTTP server closed');
  });

  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Swagger documentation available at: http://localhost:${port}/api`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`Health check available at: http://localhost:${port}/health`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application', error);
  process.exit(1);
});
