import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  // Base de datos de la app. Default: el Postgres de docker compose en dev.
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://postgres:postgres@localhost:5441/pokemon'),
  // Redis de la cola de corridas. Default: el Redis de docker compose en dev.
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).default('redis://localhost:6411'),
  POKEAPI_URL: z
    .url({ protocol: /^https?$/ })
    .default('https://pokeapi.co/api/v2')
    .transform((url) => url.replace(/\/+$/, '')),
  // Pokémon 1..POKEMON_LIMIT que baja el paso scrape.
  POKEMON_LIMIT: z.coerce.number().int().min(2).max(1025).default(100),
  // Cuánto vale el lock de la corrida en Redis (se renueva solo mientras el worker vive).
  // Si el worker muere, otro retoma la corrida pasado este plazo; se baja solo en pruebas.
  LOCK_DURATION_MS: z.coerce.number().int().min(1000).default(30_000),
});

export type Env = z.output<typeof envSchema>;
