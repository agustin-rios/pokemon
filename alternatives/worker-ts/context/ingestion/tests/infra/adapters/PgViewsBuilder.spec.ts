import pg from 'pg';
import { PgViewsBuilder } from '../../../src/infra/adapters/PgViewsBuilder.ts';
import { PrismaDatasetLoader } from '../../../src/infra/adapters/PrismaDatasetLoader.ts';
import { PrismaStagingStore } from '../../../src/infra/adapters/PrismaStagingStore.ts';
import { liveContext, stageReference } from '../helpers.ts';
import { createTestDb, testDatabaseUrl, type TestDb } from '../testDb.ts';

describe.skipIf(!testDatabaseUrl)('PgViewsBuilder (Postgres)', () => {
  let db: TestDb;
  let builder: PgViewsBuilder;

  beforeAll(async () => {
    db = await createTestDb(testDatabaseUrl ?? '');
    builder = new PgViewsBuilder(db.url);
    const store = new PrismaStagingStore(db.prisma, db.stagingSchema);
    await stageReference(store);
    await new PrismaDatasetLoader(db.prisma, db.stagingSchema).load(
      { captures: [], battles: [171, 290, 1278, 1813] },
      liveContext(),
    );
  });
  afterAll(() => db?.drop());

  it('crea las vistas sobre los datos cargados y se puede repetir', async () => {
    const signal = new AbortController().signal;

    await builder.build(signal);
    await builder.build(signal);

    const { rows } = await db.sql.query(
      'SELECT count(*)::int AS n FROM type_summary',
    );
    expect(rows[0].n).toBe(16);
  });

  it('con la señal ya abortada ni se conecta y propaga el motivo', async () => {
    const reason = new Error('plazo vencido');

    await expect(builder.build(AbortSignal.abort(reason))).rejects.toBe(reason);
  });

  it('cancelar en pleno bloqueo corta la consulta y propaga el motivo', async () => {
    // Otra sesión retiene un lock exclusivo sobre `pokemon`: crear la vista espera.
    const blocker = new pg.Client({ connectionString: db.url });
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE pokemon IN ACCESS EXCLUSIVE MODE');
    try {
      const controller = new AbortController();
      const reason = new Error('apagado');
      const started = Date.now();
      const pending = builder.build(controller.signal);
      setTimeout(() => controller.abort(reason), 300);

      await expect(pending).rejects.toBe(reason);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  });
});
