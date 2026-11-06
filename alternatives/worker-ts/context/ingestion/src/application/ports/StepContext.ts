import type { RunFence } from './RunFence.ts';

/** Lo que recibe cada paso al ejecutarse. */
export interface StepContext {
  /**
   * Se aborta cuando el paso debe terminar ya: plazo vencido o apagado. Los pasos lo
   * pasan a toda operación cancelable y lo revisan antes de escribir.
   */
  readonly signal: AbortSignal;
  readonly fence: RunFence;
}
