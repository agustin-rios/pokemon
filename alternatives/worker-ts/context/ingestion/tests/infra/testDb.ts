import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPrismaClient, type PrismaClient } from '@pokemon/db-main';
import pg from 'pg';

/** Las pruebas de infra necesitan una base real: se saltan si no hay TEST_DATABASE_URL. */
export const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

const dbMain = (path: string) =>
  fileURLToPath(new URL(`../../../../db/main/${path}`, import.meta.url));

export interface TestDb {
  /** Conexión a la base con el schema de prueba como search_path. */
  readonly url: string;
  /** Schema de staging de esta prueba (la migración crea `staging`, global). */
  readonly stagingSchema: string;
  readonly prisma: PrismaClient;
  /** Cliente directo, con el mismo search_path, para preparar y comprobar datos. */
  readonly sql: pg.Client;
  drop(): Promise<void>;
}

let counter = 0;

/**
 * Crea un schema propio para las tablas finales y otro para staging, les aplica las
 * migraciones de Prisma y conecta con el primero como search_path; `drop` los borra.
 * Cada archivo de prueba usa los suyos, así que pueden correr en paralelo sin
 * pisarse ni tocar datos reales.
 */
export async function createTestDb(base: string): Promise<TestDb> {
  const schema = `test_${process.pid}_${Date.now()}_${counter++}`;
  const stagingSchema = `${schema}_staging`;

  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  const u = new URL(base);
  u.searchParams.set('options', `-c search_path=${schema}`);
  const url = u.toString();

  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const dir = dbMain('prisma/migrations');
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const migration = await readFile(`${dir}/${name}/migration.sql`, 'utf8');
    await sql.query(migration.replaceAll('"staging"', `"${stagingSchema}"`));
  }

  const prisma = createPrismaClient(url);
  return {
    url,
    stagingSchema,
    prisma,
    sql,
    drop: async () => {
      await prisma.$disconnect();
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.query(`DROP SCHEMA IF EXISTS "${stagingSchema}" CASCADE`);
      await sql.end();
    },
  };
}
