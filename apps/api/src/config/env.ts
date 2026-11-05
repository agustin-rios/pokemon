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
      .default('postgresql://postgres:postgres@localhost:5434/pokemon'),
    // Airflow, para disparar el DAG de carga. Default: el de docker compose en dev.
    AIRFLOW_URL: z
      .url({ protocol: /^https?$/ })
      .default('http://localhost:8080')
      .transform((url) => url.replace(/\/+$/, '')),
    AIRFLOW_USERNAME: z.string().min(1).default('airflow'),
    AIRFLOW_PASSWORD: z.string().min(1).default('airflow'),
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
