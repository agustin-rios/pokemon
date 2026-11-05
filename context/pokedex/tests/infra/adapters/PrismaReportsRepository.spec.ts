import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPrismaClient, type PrismaClient } from '@pokemon/db-main';
import pg from 'pg';
import { PrismaReportsRepository } from '../../../src/infra/adapters/PrismaReportsRepository.ts';

/**
 * Test de contrato entre las vistas y el adapter. Aplica, en un schema propio,
 * las migraciones de Prisma y el mismo db/main/sql/views.sql que ejecuta el DAG;
 * carga unos pocos datos y verifica lo que devuelve PrismaReportsRepository.
 * Si alguien cambia una vista (nombre, columna, tipo, regla) sin el adapter, o
 * al revés, falla. Necesita TEST_DATABASE_URL: cualquier base de Postgres, solo
 * crea y borra su propio schema.
 */
const url = process.env['TEST_DATABASE_URL'];
const dbMain = (path: string) =>
  fileURLToPath(new URL(`../../../../../db/main/${path}`, import.meta.url));

const schema = `contract_${process.pid}_${Date.now()}`;

/** Misma base, pero con el schema de prueba como search_path. */
function inSchema(connectionString: string): string {
  const u = new URL(connectionString);
  u.searchParams.set('options', `-c search_path=${schema}`);
  return u.toString();
}

// Pensado para ejercitar cada regla: un Pokémon con un tipo y dos con dos tipos;
// Kanto con 4 entrenadores (corte del top 3 y empate resuelto por id); meses con
// subida y bajada; niveles justo en el borde de 50.
const FIXTURE = `
  INSERT INTO types (id, name) VALUES (1, 'normal'), (3, 'flying'), (10, 'fire');
  INSERT INTO pokemon (id, name, height, weight, base_experience, sprite_url) VALUES
    (1, 'p1', 1, 1, 100, NULL), (2, 'p2', 1, 1, 51, NULL), (3, 'p3', 1, 1, 60, NULL);
  INSERT INTO pokemon_types (pokemon_id, type_id, slot) VALUES
    (1, 1, 1), (2, 10, 1), (2, 3, 2), (3, 1, 1), (3, 3, 2);
  INSERT INTO trainers (id, name, region, created_at) VALUES
    (1, 'Ana', 'Kanto', '2025-01-01'), (2, 'Beto', 'Kanto', '2025-01-01'),
    (3, 'Caro', 'Kanto', '2025-01-01'), (4, 'Dani', 'Kanto', '2025-01-01'),
    (5, 'Eli', 'Johto', '2025-01-01');
  INSERT INTO captures (id, trainer_id, pokemon_id, captured_at, level, location) VALUES
    (1, 1, 1, '2026-01-05 10:00:00', 10, 'Route 1'),
    (2, 1, 2, '2026-01-20 10:00:00', 60, 'Route 1'),
    (3, 2, 3, '2026-02-01 00:00:00', 50, 'Route 1'),
    (4, 3, 1, '2026-02-14 10:00:00', 49, 'Route 1'),
    (5, 4, 2, '2026-02-28 23:59:59', 5, 'Route 1'),
    (6, 5, 3, '2026-03-10 10:00:00', 99, 'Route 1');
`;

async function migrationsSql(): Promise<string[]> {
  const dir = dbMain('prisma/migrations');
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    names.map((name) => readFile(`${dir}/${name}/migration.sql`, 'utf8')),
  );
}

describe.skipIf(!url)('PrismaReportsRepository ↔ db/main/sql/views.sql', () => {
  let admin: pg.Client;
  let prisma: PrismaClient;
  let reports: PrismaReportsRepository;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    for (const sql of await migrationsSql()) await admin.query(sql);
    await admin.query(FIXTURE);
    await admin.query(await readFile(dbMain('sql/views.sql'), 'utf8'));

    prisma = createPrismaClient(inSchema(url ?? ''));
    reports = new PrismaReportsRepository(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('typeSummary: un Pokémon con dos tipos cuenta en ambos', async () => {
    await expect(reports.typeSummary()).resolves.toEqual([
      {
        typeId: 10,
        typeName: 'fire',
        pokemonCount: 1,
        averageBaseExperience: 51,
      },
      {
        typeId: 3,
        typeName: 'flying',
        pokemonCount: 2,
        averageBaseExperience: 55.5,
      },
      {
        typeId: 1,
        typeName: 'normal',
        pokemonCount: 2,
        averageBaseExperience: 80,
      },
    ]);
  });

  it('monthlyCaptureGrowth (A): % vs. el mes anterior, null en el primero', async () => {
    await expect(reports.monthlyCaptureGrowth()).resolves.toEqual([
      { month: '2026-01', captures: 2, changePercent: null },
      { month: '2026-02', captures: 3, changePercent: 50 },
      { month: '2026-03', captures: 1, changePercent: -66.67 },
    ]);
  });

  it('topTrainersByRegion (B): máximo 3 por región, empates por id', async () => {
    await expect(reports.topTrainersByRegion()).resolves.toEqual([
      {
        region: 'Johto',
        rank: 1,
        trainerId: 5,
        trainerName: 'Eli',
        captures: 1,
      },
      {
        region: 'Kanto',
        rank: 1,
        trainerId: 1,
        trainerName: 'Ana',
        captures: 2,
      },
      {
        region: 'Kanto',
        rank: 2,
        trainerId: 2,
        trainerName: 'Beto',
        captures: 1,
      },
      {
        region: 'Kanto',
        rank: 3,
        trainerId: 3,
        trainerName: 'Caro',
        captures: 1,
      },
    ]);
  });

  it('levelClassificationByType (C): nivel ≥ 50, la captura cuenta en cada tipo', async () => {
    await expect(reports.levelClassificationByType()).resolves.toEqual([
      {
        typeId: 10,
        typeName: 'fire',
        totalCaptures: 2,
        highLevelCaptures: 1,
        highLevelPercent: 50,
      },
      {
        typeId: 3,
        typeName: 'flying',
        totalCaptures: 4,
        highLevelCaptures: 3,
        highLevelPercent: 75,
      },
      {
        typeId: 1,
        typeName: 'normal',
        totalCaptures: 4,
        highLevelCaptures: 2,
        highLevelPercent: 50,
      },
    ]);
  });
});
