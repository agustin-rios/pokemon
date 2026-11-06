import { generateSyntheticData, type Dataset } from '@pokemon/pokemon-data';
import { sqlState } from '../../../src/domain/errors.ts';
import { PrismaStagingStore } from '../../../src/infra/adapters/PrismaStagingStore.ts';
import { referenceRows } from '../../fixtures.ts';
import { liveContext, lostFenceContext, stageReference } from '../helpers.ts';
import { createTestDb, testDatabaseUrl, type TestDb } from '../testDb.ts';

const small: Dataset = {
  types: [
    { id: 1, name: 'normal' },
    { id: 3, name: 'flying' },
  ],
  pokemon: [
    {
      id: 16,
      name: 'pidgey',
      height: 3,
      weight: 18,
      base_experience: 50,
      sprite_url: 'https://img/16.png',
    },
    {
      id: 19,
      name: 'rattata',
      height: 3,
      weight: 35,
      base_experience: null,
      sprite_url: null,
    },
  ],
  pokemonTypes: [
    { pokemon_id: 16, type_id: 1, slot: 1 },
    { pokemon_id: 16, type_id: 3, slot: 2 },
    { pokemon_id: 19, type_id: 1, slot: 1 },
  ],
};

describe.skipIf(!testDatabaseUrl)('PrismaStagingStore (Postgres)', () => {
  let db: TestDb;
  let store: PrismaStagingStore;

  const count = async (table: string) =>
    (
      await db.sql.query(
        `SELECT count(*)::int AS n FROM "${db.stagingSchema}"."${table}"`,
      )
    ).rows[0].n as number;

  beforeAll(async () => {
    db = await createTestDb(testDatabaseUrl ?? '');
    store = new PrismaStagingStore(db.prisma, db.stagingSchema);
  });
  afterAll(() => db?.drop());
  beforeEach(() =>
    db.sql.query(
      `TRUNCATE "${db.stagingSchema}".types, "${db.stagingSchema}".pokemon, "${db.stagingSchema}".pokemon_types,
        "${db.stagingSchema}".trainers, "${db.stagingSchema}".captures, "${db.stagingSchema}".battles`,
    ),
  );

  describe('replaceScraped', () => {
    it('escribe types, pokemon y pokemon_types, con los NULL', async () => {
      await store.replaceScraped(small, liveContext());

      const { rows } = await db.sql.query(
        `SELECT id, name, base_experience, sprite_url FROM "${db.stagingSchema}".pokemon ORDER BY id`,
      );
      expect(rows).toEqual([
        {
          id: 16,
          name: 'pidgey',
          base_experience: 50,
          sprite_url: 'https://img/16.png',
        },
        { id: 19, name: 'rattata', base_experience: null, sprite_url: null },
      ]);
      expect([await count('types'), await count('pokemon_types')]).toEqual([
        2, 3,
      ]);
    });

    it('reemplaza lo anterior y no toca las tablas del paso generate', async () => {
      await stageReference(store);

      await store.replaceScraped(small, liveContext());

      expect([
        await count('types'),
        await count('pokemon'),
        await count('pokemon_types'),
      ]).toEqual([2, 2, 3]);
      expect([
        await count('trainers'),
        await count('captures'),
        await count('battles'),
      ]).toEqual([50, 5000, 2000]);
    });

    it('si falla a mitad (id fuera de rango), la transacción se revierte y quedan los datos anteriores', async () => {
      await stageReference(store);
      const broken: Dataset = {
        ...small,
        pokemon: [{ ...small.pokemon[0]!, id: 3_000_000_000 }],
      };

      const error = await store
        .replaceScraped(broken, liveContext())
        .catch((e: unknown) => e);

      expect(sqlState(error)).toBe('22003');
      expect([await count('types'), await count('pokemon')]).toEqual([16, 100]);
    });

    it('si el cerco ya no es nuestro, revierte: staging queda como estaba', async () => {
      await stageReference(store);

      await expect(
        store.replaceScraped(small, lostFenceContext()),
      ).rejects.toMatchObject({ name: 'FenceLostError' });

      expect([
        await count('types'),
        await count('pokemon'),
        await count('pokemon_types'),
      ]).toEqual([16, 100, 148]);
    });

    it('si el paso fue cancelado, no confirma y propaga el motivo', async () => {
      await stageReference(store);
      const controller = new AbortController();
      const reason = new Error('plazo vencido');
      controller.abort(reason);

      await expect(
        store.replaceScraped(small, {
          signal: controller.signal,
          fence: lostFenceContext().fence,
        }),
      ).rejects.toBe(reason);
      expect(await count('pokemon')).toBe(100);
    });
  });

  describe('findPokemonIds', () => {
    it('ids distintos, no nulos y ordenados', async () => {
      await db.sql.query(
        `INSERT INTO "${db.stagingSchema}".pokemon (id, name) VALUES (7, 'a'), (3, 'b'), (7, 'c'), (NULL, 'd'), (5, 'e')`,
      );

      await expect(store.findPokemonIds()).resolves.toEqual([3, 5, 7]);
    });

    it('sin filas, lista vacía', async () => {
      await expect(store.findPokemonIds()).resolves.toEqual([]);
    });
  });

  describe('replaceGenerated', () => {
    it('escribe los datos del generador: 50 entrenadores, 5000 capturas, 2000 batallas', async () => {
      const ids = Array.from({ length: 100 }, (_, i) => i + 1);
      const data = generateSyntheticData(ids);

      await store.replaceGenerated(data, liveContext());

      expect([
        await count('trainers'),
        await count('captures'),
        await count('battles'),
      ]).toEqual([50, 5000, 2000]);
      const { rows } = await db.sql.query(
        `SELECT created_at::text AS day FROM "${db.stagingSchema}".trainers WHERE id = 1`,
      );
      expect(rows[0].day).toBe(data.trainers[0]?.created_at);
    });

    it('si el cerco ya no es nuestro, revierte y no toca las tablas del scrape', async () => {
      await store.replaceScraped(small, liveContext());
      const data = generateSyntheticData([1, 2, 3], {
        captures: 5,
        battles: 5,
      });

      await expect(
        store.replaceGenerated(data, lostFenceContext()),
      ).rejects.toMatchObject({ name: 'FenceLostError' });

      expect(await count('trainers')).toBe(0);
      expect(await count('pokemon')).toBe(2);
    });
  });

  describe('readAll', () => {
    it('devuelve las 6 tablas de la corrida de referencia, ordenadas por clave y con fechas como texto', async () => {
      await stageReference(store);

      await expect(store.readAll()).resolves.toEqual(referenceRows());
    });

    it('ordena por clave dejando los NULL al final; pokemon_types por pokemon_id y type_id', async () => {
      const t = `"${db.stagingSchema}"`;
      await db.sql.query(`
        INSERT INTO ${t}.types (id, name) VALUES (5, 'e'), (NULL, 'x'), (2, 'b');
        INSERT INTO ${t}.pokemon_types (pokemon_id, type_id, slot)
          VALUES (2, 9, 1), (1, 7, 1), (NULL, 1, 1), (2, 3, 2), (1, 2, 2)`);

      const rows = await store.readAll();

      expect(rows.types.map((r) => r['id'])).toEqual([2, 5, null]);
      expect(
        rows.pokemon_types.map((r) => [r['pokemon_id'], r['type_id']]),
      ).toEqual([
        [1, 2],
        [1, 7],
        [2, 3],
        [2, 9],
        [null, 1],
      ]);
      expect(rows.pokemon).toEqual([]);
    });
  });
});
