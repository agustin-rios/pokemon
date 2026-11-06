/** Pasos del pipeline, siempre en este orden (`position` 1..5). */
export const STEPS = [
  'scrape',
  'generate',
  'validate',
  'load',
  'build_views',
] as const;
export type StepName = (typeof STEPS)[number];

export type RunState = 'queued' | 'running' | 'succeeded' | 'failed';
export type StepState = 'pending' | 'running' | 'succeeded' | 'failed';

export interface EtlStep {
  readonly name: StepName;
  readonly state: StepState;
  /** Veces que se empezó el paso (reintentos y retomas incluidos). */
  readonly attempts: number;
  /** Fechas ISO en UTC. */
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: string | null;
  readonly output: unknown;
}

export interface EtlRun {
  readonly runId: string;
  readonly state: RunState;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** Ejecuciones empezadas de la corrida. */
  readonly attempts: number;
  readonly error: string | null;
  /** Siempre los 5 pasos, en el orden del pipeline. */
  readonly steps: readonly EtlStep[];
}

const pendingStep = (name: StepName): EtlStep => ({
  name,
  state: 'pending',
  attempts: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  output: null,
});

/** Los 5 pasos en el orden del pipeline: los guardados donde los haya y `pending` donde falten. */
export function withAllSteps(saved: readonly EtlStep[] = []): EtlStep[] {
  return STEPS.map(
    (name) => saved.find((step) => step.name === name) ?? pendingStep(name),
  );
}

/**
 * Los pasos que quedan por ejecutar al retomar una corrida: todos los que no
 * terminaron (pendientes, fallidos o `running` dejados por una ejecución caída),
 * en orden. Un paso exitoso no se repite dentro de la misma corrida.
 */
export function remainingSteps(
  steps: readonly Pick<EtlStep, 'name' | 'state'>[],
): StepName[] {
  const done = new Set(
    steps.filter((step) => step.state === 'succeeded').map((step) => step.name),
  );
  return STEPS.filter((name) => !done.has(name));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isRunId = (value: string): boolean => UUID.test(value);
