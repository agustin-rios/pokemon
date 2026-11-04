import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envSchema } from './env.ts';

// Lee el .env del directorio actual (apps/api con Nx) salvo en producción.
// Si el entorno no cumple el schema, la API no arranca.
export const ConfigModule = NestConfigModule.forRoot({
  isGlobal: true,
  ignoreEnvFile: process.env['NODE_ENV'] === 'production',
  validationSchema: envSchema,
});

export type { Env } from './env.ts';
