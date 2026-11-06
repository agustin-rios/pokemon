import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  // Sin servidor HTTP: el worker solo consume la cola.
  const app = await NestFactory.createApplicationContext(AppModule);
  // SIGTERM/SIGINT: EtlProcessor termina el paso en curso y cierra el worker antes de
  // desconectar la base (ver beforeApplicationShutdown). useProcessExit: al terminar sale
  // con código 0 (sin él Nest se reenvía la señal y el proceso sale con 143) y no lo
  // retiene una conexión a Postgres que haya quedado colgada.
  app.enableShutdownHooks([], { useProcessExit: true });
  logger.log('Worker listo: espera corridas en la cola etl');
}

bootstrap().catch((err: unknown) => {
  logger.error(
    'El worker no pudo arrancar',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
