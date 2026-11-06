import { Prisma } from '@pokemon/db-main';
import type { PrismaClient } from '@pokemon/db-main';
import type { Dataset, SyntheticData } from '@pokemon/pokemon-data';

import type { StagingStore } from '../../application/ports/StagingStore.ts';
import type { StepContext } from '../../application/ports/StepContext.ts';
import {
  LOAD_ORDER,
  TABLES,
  UNIQUE,
  type ColumnKind,
  type Row,
  type StagingRows,
  type TableName,
  type Value,
} from '../../domain/index.ts';
import { inTransaction, STAGING_SCHEMA, stagingTable } from './postgres.ts';

/** Tipo SQL con el que se envía cada columna: las fechas y horas viajan como texto y se convierten en SQL. */
const SQL_TYPES: Readonly<Record<ColumnKind, string>> = {
  integer: 'int',
  smallint: 'smallint',
  text: 'text',
  date: 'date',
  timestamp: 'timestamp',
};

const SCRAPED: readonly TableName[] = ['types', 'pokemon', 'pokemon_types'];
const GENERATED: readonly TableName[] = ['trainers', 'captures', 'battles'];

/** Staging en Postgres (schema `staging`, creado por la migración). */
export class PrismaStagingStore implements StagingStore {
  private readonly prisma: PrismaClient;
  private readonly schema: string;

  constructor(prisma: PrismaClient, schema = STAGING_SCHEMA) {
    this.prisma = prisma;
    this.schema = schema;
  }

  replaceScraped(dataset: Dataset, context: StepContext): Promise<void> {
    return this.replace(
      SCRAPED,
      {
        types: dataset.types,
        pokemon: dataset.pokemon,
        pokemon_types: dataset.pokemonTypes,
      },
      context,
    );
  }

  replaceGenerated(data: SyntheticData, context: StepContext): Promise<void> {
    return this.replace(
      GENERATED,
      {
        trainers: data.trainers,
        captures: data.captures,
        battles: data.battles,
      },
      context,
    );
  }

  async findPokemonIds(): Promise<number[]> {
    const rows = await inTransaction(this.prisma, (tx) =>
      tx.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT DISTINCT id FROM ${this.table('pokemon')} WHERE id IS NOT NULL ORDER BY id`,
      ),
    );
    return rows.map((row) => row.id);
  }

  readAll(): Promise<StagingRows> {
    return inTransaction(this.prisma, async (tx) => {
      const rows = {} as Record<TableName, Row[]>;
      for (const table of LOAD_ORDER) {
        // Fechas y horas como texto, sin pasar por un Date (que las movería de zona).
        const columns = TABLES[table]
          .map(({ name, kind }) =>
            kind === 'date' || kind === 'timestamp'
              ? `"${name}"::text AS "${name}"`
              : `"${name}"`,
          )
          .join(', ');
        // La primera clave única es también el orden de lectura; los NULL quedan al final.
        const order = (UNIQUE[table][0] ?? []).join(', ');
        rows[table] = await tx.$queryRaw<Row[]>(
          Prisma.sql`SELECT ${Prisma.raw(columns)} FROM ${this.table(table)} ORDER BY ${Prisma.raw(order)}`,
        );
      }
      return rows;
    });
  }

  /**
   * Una transacción: vacía las tablas, inserta las filas y, tras comprobar que no se
   * canceló y que el cerco sigue siendo nuestro, confirma.
   */
  private replace(
    tables: readonly TableName[],
    rows: Readonly<Record<string, readonly object[]>>,
    { signal, fence }: StepContext,
  ): Promise<void> {
    return inTransaction(this.prisma, async (tx) => {
      signal.throwIfAborted();
      await tx.$executeRaw(
        Prisma.sql`TRUNCATE ${Prisma.join(tables.map((table) => this.table(table)))}`,
      );
      for (const table of tables) {
        const values = (rows[table] ?? []) as readonly Record<string, Value>[];
        const arrays = TABLES[table].map(
          ({ name, kind }) =>
            Prisma.sql`${values.map((row) => row[name] ?? null)}::${Prisma.raw(`${SQL_TYPES[kind]}[]`)}`,
        );
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO ${this.table(table)} (${Prisma.raw(TABLES[table].map(({ name }) => `"${name}"`).join(', '))})
          SELECT * FROM unnest(${Prisma.join(arrays)})`);
      }
      signal.throwIfAborted();
      await fence.assertOwned();
    });
  }

  private table(table: TableName): Prisma.Sql {
    return stagingTable(this.schema, table);
  }
}
