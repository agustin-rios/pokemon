import { Prisma } from '@pokemon/db-main';
import type { PrismaClient } from '@pokemon/db-main';

/** Tope de cada sentencia de un paso; vencido, Postgres la corta (57014) y el paso se reintenta. */
export const STATEMENT_TIMEOUT_MS = 60_000;

const TRANSACTION = { timeout: 120_000, maxWait: 10_000 };

/** Una transacción cuyas sentencias tienen `statement_timeout`. */
export function inTransaction<T>(
  prisma: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SET LOCAL statement_timeout = ${Prisma.raw(String(STATEMENT_TIMEOUT_MS))}`,
    );
    return work(tx);
  }, TRANSACTION);
}

export const STAGING_SCHEMA = 'staging';

/**
 * Tabla de staging con su schema. El schema es configurable solo para aislar las
 * pruebas; sale de configuración, nunca de datos, y se valida igual.
 */
export function stagingTable(schema: string, table: string): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`nombre de schema inválido: ${schema}`);
  }
  return Prisma.raw(`"${schema}"."${table}"`);
}
