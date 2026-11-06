import { Prisma } from '@pokemon/db-main';
import type { PrismaClient } from '@pokemon/db-main';

import type { DatasetLoader } from '../../application/ports/DatasetLoader.ts';
import type { StepContext } from '../../application/ports/StepContext.ts';
import {
  LOAD_ORDER,
  TABLES,
  type DiscardableTable,
  type TableName,
} from '../../domain/index.ts';
import { inTransaction, STAGING_SCHEMA, stagingTable } from './postgres.ts';

/** Lo que se lee de staging para cada columna: base_experience NULL se carga como 0, el default de la tabla. */
const source = (table: TableName, column: string): string =>
  table === 'pokemon' && column === 'base_experience'
    ? 'coalesce("base_experience", 0)'
    : `"${column}"`;

/** Reemplaza las 6 tablas finales con lo de staging en una sola transacción: si algo falla, los datos anteriores quedan. */
export class PrismaDatasetLoader implements DatasetLoader {
  private readonly prisma: PrismaClient;
  private readonly schema: string;

  constructor(prisma: PrismaClient, schema = STAGING_SCHEMA) {
    this.prisma = prisma;
    this.schema = schema;
  }

  load(
    discardedIds: Readonly<Record<DiscardableTable, readonly number[]>>,
    { signal, fence }: StepContext,
  ): Promise<Record<TableName, number>> {
    return inTransaction(this.prisma, async (tx) => {
      signal.throwIfAborted();
      // Los nombres de tablas y columnas salen de constantes del dominio, no de datos.
      await tx.$executeRaw(
        Prisma.sql`TRUNCATE ${Prisma.raw(LOAD_ORDER.join(', '))}`,
      );

      const counts = {} as Record<TableName, number>;
      for (const table of LOAD_ORDER) {
        const columns = TABLES[table].map(({ name }) => name);
        const without =
          table === 'captures' || table === 'battles'
            ? Prisma.sql`WHERE "id" <> ALL(${[...discardedIds[table]]}::int[])`
            : Prisma.empty;
        counts[table] = await tx.$executeRaw(Prisma.sql`
          INSERT INTO ${Prisma.raw(table)} (${Prisma.raw(columns.map((c) => `"${c}"`).join(', '))})
          SELECT ${Prisma.raw(columns.map((c) => source(table, c)).join(', '))}
          FROM ${stagingTable(this.schema, table)}
          ${without}`);
      }

      signal.throwIfAborted();
      await fence.assertOwned();
      return counts;
    });
  }
}
