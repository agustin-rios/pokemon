import {
  classifyError,
  describeError,
  FenceLostError,
  remainingSteps,
  StepAbandonedError,
  StepDeadlineError,
  withAllSteps,
  type ErrorClass,
  type EtlStep,
  type StepName,
} from '../../domain/index.ts';
import type { Logger } from '../ports/Logger.ts';
import type { RunFence } from '../ports/RunFence.ts';
import type { RunProgress } from '../ports/RunProgress.ts';
import type { StepContext } from '../ports/StepContext.ts';

/** Lo que hace un paso del pipeline; devuelve el `output` que se guarda en el paso. */
export interface StepExecutor {
  execute(context: StepContext): Promise<unknown>;
}

/** Una ejecución de la corrida: el progreso y el cerco son de esta ejecución. */
export interface RunExecution {
  readonly runId: string;
  readonly progress: RunProgress;
  readonly fence: RunFence;
  /** El worker se apaga: termina el paso en curso y no empieza otro; pasada la gracia, lo cancela. */
  readonly shutdown?: AbortSignal;
}

export interface ExecuteEtlRunOptions {
  /** Plazo de cada paso; vencido, se cancela y falla de forma reintentable. */
  readonly stepDeadlineMs: number;
  /** Tras pedirse el apagado, lo que se le deja al paso en curso antes de cancelarlo. */
  readonly shutdownGraceMs: number;
}

/**
 * - succeeded: la corrida terminó.
 * - failed: un paso falló; `errorClass` dice si reintentarlo puede arreglarlo y
 *   `message` (`<paso>: <error>`, con las causas) es el motivo para mostrar.
 * - stopped: no terminó y no se marcó como fallida. `drained`: se pidió el apagado
 *   entre dos pasos; `abandoned`: se canceló el paso en curso por el apagado;
 *   `fence`: la ejecución perdió la corrida y no escribió nada más. La corrida debe
 *   retomarse en otra ejecución.
 */
export type RunOutcome =
  | { readonly status: 'succeeded' }
  | {
      readonly status: 'failed';
      readonly step: StepName;
      readonly errorClass: ErrorClass;
      readonly message: string;
      readonly cause: unknown;
    }
  | {
      readonly status: 'stopped';
      readonly reason: 'drained' | 'abandoned' | 'fence';
    };

type StepResult =
  | { readonly status: 'done'; readonly output: unknown }
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'stopped'; readonly reason: 'abandoned' | 'fence' };

const MAX_LOGGED_OUTPUT = 300;

/**
 * Ejecuta una corrida: los pasos que faltan según el progreso guardado, en orden,
 * guardando el progreso en cada transición. Un paso exitoso no se repite.
 *
 * - Plazo: cada paso corre con su propio AbortSignal, que se aborta al vencer el plazo.
 * - Apagado: el paso en curso termina y no empieza otro; si tarda más que la gracia
 *   se cancela. En ambos casos la corrida queda sin finalizar para retomarla.
 * - Cancelación real: tras abortar espera a que el paso termine de verdad, así nunca
 *   queda un paso viejo escribiendo mientras la ejecución sigue con otra cosa. Los
 *   pasos escriben solo si el cerco lo permite, justo antes de confirmar.
 *
 * Los fallos de los pasos se devuelven clasificados; los de la infraestructura (guardar
 * el progreso) se propagan.
 */
export class ExecuteEtlRun {
  private readonly steps: Readonly<Record<StepName, StepExecutor>>;
  private readonly logger: Logger;
  private readonly options: ExecuteEtlRunOptions;

  constructor(
    steps: Readonly<Record<StepName, StepExecutor>>,
    logger: Logger,
    options: ExecuteEtlRunOptions,
  ) {
    this.steps = steps;
    this.logger = logger;
    this.options = options;
  }

  async execute(run: RunExecution): Promise<RunOutcome> {
    let steps = withAllSteps(await run.progress.load());
    const pending = remainingSteps(steps);
    this.logger.info(
      `Corrida ${run.runId}: pasos pendientes: ${pending.join(', ') || 'ninguno'}`,
    );

    for (const name of pending) {
      if (run.shutdown?.aborted) {
        this.logger.warn(
          `Corrida ${run.runId}: apagado en curso, no se empieza el paso ${name}`,
        );
        return { status: 'stopped', reason: 'drained' };
      }

      steps = update(steps, name, (step) => ({
        ...step,
        state: 'running',
        attempts: step.attempts + 1,
        startedAt: now(),
        finishedAt: null,
        error: null,
        output: null,
      }));
      await run.progress.save(steps);
      this.logger.info(`Paso ${name}: inicio`);

      const result = await this.runStep(name, run);

      if (result.status === 'stopped') {
        this.logger.warn(
          `Corrida ${run.runId}: se detiene en el paso ${name} (${result.reason}) sin escribir más`,
        );
        return result;
      }

      if (result.status === 'failed') {
        const errorClass = classifyError(result.error, name);
        const message = `${name}: ${describeError(result.error)}`;
        steps = update(steps, name, (step) => ({
          ...step,
          state: 'failed',
          finishedAt: now(),
          error: message,
        }));
        await run.progress.save(steps);
        this.logger.error(
          `Paso ${name}: falló (${errorClass === 'permanent' ? 'permanente' : 'reintentable'}): ${message.replace(/\n/g, ' | ')}`,
        );
        return {
          status: 'failed',
          step: name,
          errorClass,
          message,
          cause: result.error,
        };
      }

      const output = result.output ?? null;
      steps = update(steps, name, (step) => ({
        ...step,
        state: 'succeeded',
        finishedAt: now(),
        error: null,
        output,
      }));
      await run.progress.save(steps);
      this.logger.info(`Paso ${name}: listo${summarize(output)}`);
    }

    this.logger.info(`Corrida ${run.runId}: terminada`);
    return { status: 'succeeded' };
  }

  private async runStep(
    name: StepName,
    run: RunExecution,
  ): Promise<StepResult> {
    const { stepDeadlineMs, shutdownGraceMs } = this.options;
    const controller = new AbortController();
    let expired = false;
    let abandoned = false;

    const deadline = setTimeout(() => {
      expired = true;
      controller.abort(new StepDeadlineError(name, stepDeadlineMs));
    }, stepDeadlineMs);

    let grace: NodeJS.Timeout | undefined;
    const onShutdown = () => {
      grace = setTimeout(() => {
        abandoned = true;
        controller.abort(new StepAbandonedError(name));
      }, shutdownGraceMs);
    };
    run.shutdown?.addEventListener('abort', onShutdown, { once: true });
    if (run.shutdown?.aborted) onShutdown();

    try {
      const output = await this.steps[name].execute({
        signal: controller.signal,
        fence: run.fence,
      });
      return { status: 'done', output };
    } catch (error) {
      if (error instanceof FenceLostError) {
        return { status: 'stopped', reason: 'fence' };
      }
      if (abandoned) return { status: 'stopped', reason: 'abandoned' };
      if (expired && !(error instanceof StepDeadlineError)) {
        return {
          status: 'failed',
          error: new StepDeadlineError(name, stepDeadlineMs, { cause: error }),
        };
      }
      return { status: 'failed', error };
    } finally {
      clearTimeout(deadline);
      clearTimeout(grace);
      run.shutdown?.removeEventListener('abort', onShutdown);
    }
  }
}

const now = (): string => new Date().toISOString();

function update(
  steps: readonly EtlStep[],
  name: StepName,
  change: (step: EtlStep) => EtlStep,
): EtlStep[] {
  return steps.map((step) => (step.name === name ? change(step) : step));
}

function summarize(output: unknown): string {
  if (output === null) return '';
  const text = JSON.stringify(output);
  return ` ${
    text.length > MAX_LOGGED_OUTPUT
      ? `${text.slice(0, MAX_LOGGED_OUTPUT)}…`
      : text
  }`;
}
