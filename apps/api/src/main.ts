import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { setupApp } from './app.setup.ts';
import type { Env } from './config/index.ts';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = setupApp(await NestFactory.create(AppModule));
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.enableCors({ origin: config.get('CORS_ALLOW_ORIGINS', { infer: true }) });
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  logger.log(`API en http://localhost:${port}/api`);
}

bootstrap().catch((err: unknown) => {
  logger.error(
    'La API no pudo arrancar',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
