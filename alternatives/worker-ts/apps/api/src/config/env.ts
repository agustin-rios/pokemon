import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    // Base de datos de la app. Default: el Postgres de docker compose en dev.
    DATABASE_URL: z
      .string()
      .min(1)
      .default('postgresql://postgres:postgres@localhost:5441/pokemon'),
    // Redis de la cola de corridas (BullMQ). Default: el Redis de docker compose en dev.
    REDIS_URL: z
      .url({ protocol: /^rediss?$/ })
      .default('redis://localhost:6411'),
    // "*" → true: CORS refleja el origen de cada request.
    CORS_ALLOW_ORIGINS: z
      .string()
      .default('*')
      .transform((value) =>
        value === '*'
          ? true
          : value
              .split(',')
              .map((origin) => origin.trim())
              .filter(Boolean),
      ),
  })
  .refine(
    (env) => env.NODE_ENV !== 'production' || env.CORS_ALLOW_ORIGINS !== true,
    {
      path: ['CORS_ALLOW_ORIGINS'],
      message: 'en producción no se permite "*"',
    },
  );

export type Env = z.output<typeof envSchema>;
