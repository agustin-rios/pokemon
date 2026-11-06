import { HttpStatusError, UnexpectedTypeUrlError } from '@pokemon/pokemon-data';
import type { StepName } from './run/EtlRun.ts';

export const MAX_ERRORS_IN_MESSAGE = 50;

/** Los datos de staging no cumplen: no se debe escribir nada en las tablas finales. */
export class DataValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    const shown = errors.slice(0, MAX_ERRORS_IN_MESSAGE);
    const more =
      errors.length > shown.length
        ? `\n- … y ${errors.length - shown.length} más`
        : '';
    super(
      `${errors.length} problema(s) en los datos:\n- ${shown.join('\n- ')}${more}`,
    );
    this.name = 'DataValidationError';
    this.errors = errors;
  }
}

/** Un fallo que reintentar no arregla (p. ej. faltan Pokémon en staging para generar datos). */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

/**
 * La ejecución ya no es dueña de la corrida (el cerco falló). No es un error de la
 * corrida: la transacción se revierte y solo hay que parar.
 */
export class FenceLostError extends Error {
  constructor() {
    super('la ejecución ya no es dueña de la corrida');
    this.name = 'FenceLostError';
  }
}

/** El paso superó su plazo y se canceló. Se puede reintentar. */
export class StepDeadlineError extends Error {
  constructor(step: StepName, deadlineMs: number, options?: ErrorOptions) {
    super(`el paso ${step} superó el plazo de ${deadlineMs / 1000} s`, options);
    this.name = 'StepDeadlineError';
  }
}

/** El paso se canceló porque el apagado del worker agotó su gracia. */
export class StepAbandonedError extends Error {
  constructor(step: StepName) {
    super(`el paso ${step} se abandonó por el apagado del worker`);
    this.name = 'StepAbandonedError';
  }
}

export type ErrorClass = 'permanent' | 'retryable';

/**
 * SQLSTATE de un error de base de datos: Prisma 7 (consultas crudas) lo deja en
 * `meta.driverAdapterError.cause.originalCode` (en una violación de unicidad es
 * lo único que expone) y `pg` en `code`. undefined si el error no viene de la base.
 */
export function sqlState(error: unknown): string | undefined {
  const e = error as
    | {
        code?: unknown;
        meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } };
      }
    | null
    | undefined;
  const code = e?.meta?.driverAdapterError?.cause?.originalCode ?? e?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
    ? code
    : undefined;
}

/**
 * Permanente: datos inválidos, una respuesta HTTP que no es 429 ni 5xx, una URL de
 * tipo inesperada, errores de datos (clase 22) o de integridad (23) de la base y
 * errores de sintaxis o permisos (42) al crear las vistas. Todo lo demás se
 * puede reintentar: intentos agotados contra la PokeAPI, plazos vencidos, conexión
 * rechazada, timeouts, IO y el resto de SQLSTATE. Se decide por el tipo del error,
 * nunca por su mensaje.
 */
export function classifyError(error: unknown, step: StepName): ErrorClass {
  if (
    error instanceof DataValidationError ||
    error instanceof PermanentError ||
    error instanceof UnexpectedTypeUrlError
  ) {
    return 'permanent';
  }

  if (error instanceof HttpStatusError) {
    return error.status === 429 || error.status >= 500
      ? 'retryable'
      : 'permanent';
  }

  const state = sqlState(error);
  if (state) {
    const stateClass = state.slice(0, 2);
    if (stateClass === '22' || stateClass === '23') return 'permanent';
    if (stateClass === '42' && step === 'build_views') return 'permanent';
  }
  return 'retryable';
}

const MAX_CAUSES = 5;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * El error y su cadena de causas, una línea por causa (las de Prisma vienen en varias
 * líneas y se colapsan; `DataValidationError` conserva su lista, que es su formato).
 */
export function describeError(error: unknown): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  let current = error;

  while (
    current !== undefined &&
    !seen.has(current) &&
    seen.size < MAX_CAUSES
  ) {
    seen.add(current);
    const text =
      current instanceof DataValidationError
        ? current.message
        : oneLine(current instanceof Error ? current.message : String(current));
    lines.push(seen.size === 1 ? text : `causa: ${text}`);
    current = current instanceof Error ? current.cause : undefined;
  }
  return lines.join('\n');
}
