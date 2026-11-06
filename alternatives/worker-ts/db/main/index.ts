import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.ts';

export * from './generated/prisma/client.ts';

// El driver (pg) queda encapsulado aquí: quien consume solo pasa la URL.
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Fuente única de las vistas: la ejecuta el worker (build_views) y la lee el contexto pokedex.
export const viewsSqlPath = new URL('./sql/views.sql', import.meta.url);
