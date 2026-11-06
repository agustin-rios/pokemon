import {
  BadRequestException,
  Catch,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ValidationError } from '@pokemon/context-pokedex';

/** SQLSTATE de Postgres: la tabla o vista no existe. */
const UNDEFINED_TABLE = '42P01';

/**
 * SQLSTATE de Postgres dentro de un error de Prisma. Prisma lo envuelve: en SQL
 * directo lanza P2010 con el código real en
 * `meta.driverAdapterError.cause.originalCode` (driver adapter de pg).
 */
function sqlState(error: unknown): string | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (typeof current !== 'object' || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const e = current as {
      originalCode?: unknown;
      meta?: { driverAdapterError?: unknown };
      cause?: unknown;
    };
    if (typeof e.originalCode === 'string') return e.originalCode;
    pending.push(e.meta?.driverAdapterError, e.cause);
  }
  return undefined;
}

/**
 * Traduce los errores del dominio y de la base a códigos HTTP; el resto sigue
 * el manejo por defecto de Nest (HttpException tal cual, lo demás 500).
 * - ValidationError del contexto → 400.
 */
@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof ValidationError) {
      super.catch(new BadRequestException(exception.message), host);
      return;
    }
    if (sqlState(exception) === UNDEFINED_TABLE) {
      super.catch(
        new ServiceUnavailableException('Los datos todavía no están cargados.'),
        host,
      );
      return;
    }
    super.catch(exception, host);
  }
}
