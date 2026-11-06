import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envSchema } from './env.ts';

// Lee el .env del directorio actual (apps/worker con Nx) salvo en producción.
// Si el entorno no cumple el schema, el worker no arranca.
export const ConfigModule = NestConfigModule.forRoot({
  isGlobal: true,
  ignoreEnvFile: process.env['NODE_ENV'] === 'production',
  validationSchema: envSchema,
});

/**
 * El lock del job lo fija el decorador de `EtlProcessor`, que se evalúa al importar el
 * módulo, antes de que exista el ConfigService. Como `forRoot` ya cargó el .env, se lee aquí
 * con el mismo schema que valida el arranque.
 */
export const lockDurationMs = envSchema.shape.LOCK_DURATION_MS.parse(
  process.env['LOCK_DURATION_MS'],
);

export type { Env } from './env.ts';
