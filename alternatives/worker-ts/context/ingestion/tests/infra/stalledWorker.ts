// Worker de BullMQ en un proceso aparte, para matarlo con SIGKILL en mitad de un paso.
// Se ejecuta con Node quitando los tipos: node tests/infra/stalledWorker.ts
import { Worker } from 'bullmq';
import { connectionOf, etlProcessor, stepsWith } from './redis.ts';

const { REDIS_URL, QUEUE_PREFIX, LOCK_DURATION_MS } = process.env;

// `scrape` termina; `generate` se queda colgado para siempre (nunca llega a `validate`).
const processor = etlProcessor(
  stepsWith({ generate: () => new Promise<never>(() => undefined) }),
  { lockDurationMs: Number(LOCK_DURATION_MS) },
);

new Worker('etl', processor, {
  connection: connectionOf(REDIS_URL ?? ''),
  prefix: QUEUE_PREFIX ?? '',
  concurrency: 1,
  lockDuration: Number(LOCK_DURATION_MS),
  // El chequeo de jobs estancados deja una marca de esta duración en Redis: si el worker
  // muere, hasta que vence nadie más revisa. Corta para que la prueba no espere 30 s.
  stalledInterval: 500,
});
console.log('listo');
