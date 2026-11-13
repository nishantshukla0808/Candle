import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppLogger } from './common/services/logger.service';
import { CONFIG } from './config/config.module';
import type { AppConfig } from './config/configuration';
import { LiveRedisAdapter } from './modules/duels/live-redis.adapter';

/**
 * Bootstrap — blueprint §9 pipeline steps 2-3 (Helmet, CORS).
 * Steps 1 & 4 (RequestId, RateLimit) are middleware configured in
 * AppModule; steps 5-11 are APP_* providers in AppModule.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(AppLogger);
  app.useLogger(logger);

  const config = app.get<AppConfig>(CONFIG);

  // Cookie parsing — refresh tokens travel in httpOnly cookies (ADR 0002).
  app.use(cookieParser());

  // 2. Helmet — secure headers, before CORS.
  app.use(helmet());

  // 3. CORS — allow-listed origins only; credentials ONLY for the web origin.
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Non-browser clients (curl, health probes) send no Origin.
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      logger.warn('CORS rejected origin', { origin });
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    maxAge: 600,
  });

  // Base path versioned from day one (blueprint §6).
  app.setGlobalPrefix('api/v1');

  // OpenAPI — auto-generated docs from controller annotations (§15).
  const docConfig = new DocumentBuilder()
    .setTitle('Candle API')
    .setDescription('Gamified financial learning platform — own APIs, no BaaS.')
    .setVersion('v1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, docConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Multi-server WebSocket fan-out (docs/05 §3.4, docs/09 §7): only when
  // WS_REDIS_ADAPTER_ENABLED=true AND the load balancer pins each
  // connection to one server (sticky sessions). Single-server v1 runs
  // without it — the in-process Socket.IO server is enough.
  if (config.WS_REDIS_ADAPTER_ENABLED) {
    app.useWebSocketAdapter(new LiveRedisAdapter(app, config));
    logger.info('Socket.IO Redis adapter enabled (sticky LB required)');
  }

  await app.listen(config.PORT, '0.0.0.0');
  logger.info('API listening', { port: config.PORT, env: config.NODE_ENV });
}

void bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[bootstrap] Fatal error during startup', err);
  process.exit(1);
});
