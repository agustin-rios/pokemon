import { PrismaDatasetLoader } from '../../../src/infra/adapters/PrismaDatasetLoader.ts';
import { PrismaStagingStore } from '../../../src/infra/adapters/PrismaStagingStore.ts';
import { sqlState, validateStaging } from '../../../src/index.ts';
import { referenceRows, REFERENCE_CHECKSUM } from '../../fixtures.ts';
import {
  CHECKSUM,
  liveContext,
  lostFenceContext,
  stageReference,
} from '../helpers.ts';
import { createTestDb, testDatabaseUrl, type TestDb } from '../testDb.ts';

const REFERENCE_DISCARDS = { captures: [], battles: [171, 290, 1278, 1813] };

describe.skipIf(!testDatabaseUrl)('PrismaDatasetLoader (Postgres)', () => {
  let db: TestDb;
  let store: PrismaStagingStore;
  let loader: PrismaDatasetLoader;

  const checksum = async () =>
    (await db.sql.query(CHECKSUM)).rows[0].checksum as string;
  const staging = (table: string) => `"${db.stagingSchema}"."${table}"`;

  beforeAll(async () => {
    db = await createTestDb(testDatabaseUrl ?? '');
    store = new PrismaStagingStore(db.prisma, db.stagingSchema);
    loader = new PrismaDatasetLoader(db.prisma, db.stagingSchema);
  });
  afterAll(() => db?.drop());
  beforeEach(() =>
    db.sql.query(
      `TRUNCATE types, pokemon, pokemon_types, trainers, captures, battles CASCADE;
       TRUNCATE ${['types', 'pokemon', 'pokemon_types', 'trainers', 'captures', 'battles'].map(staging).join(', ')}`,
    ),
  );

  it('pasa staging a las 6 tablas finales y deja los mismos datos que la corrida de referencia', async () => {
    await stageReference(store);

    await expect(
      loader.load(REFERENCE_DISCARDS, liveContext()),
    ).resolves.toEqual({
      types: 16,
      pokemon: 100,
      pokemon_types: 148,
      trainers: 50,
      captures: 5000,
      battles: 1996,
    });
    await expect(checksum()).resolves.toBe(REFERENCE_CHECKSUM);
  });

  it('los descartes que calcula la validación son los que se excluyen', async () => {
    await stageReference(store);
    const { discardedIds } = validateStaging(await store.readAll());

    await loader.load(discardedIds, liveContext());

    await expect(checksum()).resolves.toBe(REFERENCE_CHECKSUM);
  });

  it('es idempotente: cargar de nuevo deja lo mismo', async () => {
    await stageReference(store);

    await loader.load(REFERENCE_DISCARDS, liveContext());
    await loader.load(REFERENCE_DISCARDS, liveContext());

    await expect(checksum()).resolves.toBe(REFERENCE_CHECKSUM);
  });

  it('no toca staging', async () => {
    await stageReference(store);

    await loader.load(REFERENCE_DISCARDS, liveContext());

    await expect(store.readAll()).resolves.toEqual(referenceRows());
  });

  it('base_experience NULL se carga como 0 y sprite_url NULL se conserva; fechas y horas sin moverse de zona', async () => {
    await stageReference(store);
    await db.sql.query(
      `UPDATE ${staging('pokemon')} SET base_experience = NULL, sprite_url = NULL WHERE id = 1`,
    );

    await loader.load(REFERENCE_DISCARDS, liveContext());

    const { rows } = await db.sql.query(`
      SELECT (SELECT base_experience FROM pokemon WHERE id = 1) AS exp,
             (SELECT sprite_url FROM pokemon WHERE id = 1) AS sprite,
             (SELECT created_at::text FROM trainers WHERE id = 1) AS day,
             (SELECT captured_at::text FROM captures WHERE id = 1) AS at`);
    expect(rows[0]).toEqual({
      exp: 0,
      sprite: null,
      day: '2025-06-14',
      at: '2025-11-01 02:22:00',
    });
  });

  it('excluye las capturas y batallas indicadas', async () => {
    await stageReference(store);

    await expect(
      loader.load(
        { ...REFERENCE_DISCARDS, captures: [1, 2, 3] },
        liveContext(),
      ),
    ).resolves.toMatchObject({ captures: 4997, battles: 1996 });
    const { rows } = await db.sql.query(
      'SELECT count(*)::int AS n FROM captures WHERE id IN (1, 2, 3)',
    );
    expect(rows[0].n).toBe(0);
  });

  it('con el cerco perdido revierte: las tablas finales quedan como estaban', async () => {
    await stageReference(store);
    await loader.load(REFERENCE_DISCARDS, liveContext());
    // Staging cambia: con el cerco perdido nada de esto debe llegar a las finales.
    await db.sql.query(`DELETE FROM ${staging('captures')}`);

    await expect(
      loader.load(REFERENCE_DISCARDS, lostFenceContext()),
    ).rejects.toMatchObject({ name: 'FenceLostError' });

    await expect(checksum()).resolves.toBe(REFERENCE_CHECKSUM);
  });

  it('con la señal abortada no escribe y propaga el motivo', async () => {
    await stageReference(store);
    await loader.load(REFERENCE_DISCARDS, liveContext());
    const controller = new AbortController();
    const reason = new Error('apagado');
    controller.abort(reason);

    await expect(
      loader.load(REFERENCE_DISCARDS, {
        signal: controller.signal,
        fence: liveContext().fence,
      }),
    ).rejects.toBe(reason);

    await expect(checksum()).resolves.toBe(REFERENCE_CHECKSUM);
  });

  it('es atómico: si la base rechaza una tabla, las anteriores no quedan a medias', async () => {
    await stageReference(store);
    await loader.load(REFERENCE_DISCARDS, liveContext());
    // Una referencia rota que solo la FK de la base detecta (sin pasar por la validación).
    await db.sql.query(
      `UPDATE ${staging('pokemon_types')} SET type_id = 999 WHERE pokemon_id = 1 AND slot = 1`,
    );

    const error = await loader
      .load(REFERENCE_DISCARDS, liveContext())
      .catch((e: unknown) => e);

    expect(sqlState(error)).toBe('23503');
    await expect(checksum()).resolves.toBe(REFERENCE_CHECKSUM);
  });
});
