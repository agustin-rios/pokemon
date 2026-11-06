import type { Logger } from '../src/application/ports/Logger.ts';
import type { RunFence } from '../src/application/ports/RunFence.ts';
import type { RunProgress } from '../src/application/ports/RunProgress.ts';
import type { RunQueue } from '../src/application/ports/RunQueue.ts';
import type { StagingStore } from '../src/application/ports/StagingStore.ts';
import { STEPS, type EtlRun, type EtlStep } from '../src/index.ts';

export const stubLogger = () => ({
  info: vi.fn<Logger['info']>(),
  warn: vi.fn<Logger['warn']>(),
  error: vi.fn<Logger['error']>(),
});

/** Cola falsa: cada método es un vi.fn() que el test puede configurar. */
export const stubRunQueue = () => ({
  enqueue: vi.fn<RunQueue['enqueue']>(),
  get: vi.fn<RunQueue['get']>(),
  retry: vi.fn<RunQueue['retry']>(),
});

/** Staging falso: cada método es un vi.fn() que el test puede configurar. */
export const stubStagingStore = () => ({
  replaceScraped: vi.fn<StagingStore['replaceScraped']>().mockResolvedValue(),
  findPokemonIds: vi.fn<StagingStore['findPokemonIds']>(),
  replaceGenerated: vi
    .fn<StagingStore['replaceGenerated']>()
    .mockResolvedValue(),
  readAll: vi.fn<StagingStore['readAll']>(),
});

/** Cerco que siempre es nuestro. */
export const ownedFence = (): RunFence => ({
  assertOwned: () => Promise.resolve(),
});

/** Progreso en memoria; `saves` registra cada guardado. */
export function memoryProgress(initial: readonly EtlStep[] = []) {
  let current = initial;
  const saves: (readonly EtlStep[])[] = [];
  const progress: RunProgress = {
    load: () => Promise.resolve(current),
    save: (steps) => {
      current = steps;
      saves.push(steps);
      return Promise.resolve();
    },
  };
  return { progress, saves, current: () => current };
}

/** Un paso con el estado dado. */
export const step = (
  name: EtlStep['name'],
  state: EtlStep['state'],
  extra: Partial<EtlStep> = {},
): EtlStep => ({
  name,
  state,
  attempts: state === 'pending' ? 0 : 1,
  startedAt: null,
  finishedAt: null,
  error: null,
  output: null,
  ...extra,
});

/** Una corrida con los 5 pasos; `states` fija el estado de los primeros. */
export function runWith(
  states: Partial<Record<EtlStep['name'], EtlStep['state']>> = {},
): EtlRun {
  return {
    runId: '3f2b8a0e-5c1d-4e7a-9b6f-0a1b2c3d4e5f',
    state: 'running',
    queuedAt: '2026-11-05T22:19:30.778Z',
    startedAt: '2026-11-05T22:19:31.000Z',
    finishedAt: null,
    attempts: 1,
    error: null,
    steps: STEPS.map((name) => step(name, states[name] ?? 'pending')),
  };
}
