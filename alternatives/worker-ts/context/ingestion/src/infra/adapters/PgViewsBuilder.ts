import { readFile } from 'node:fs/promises';

import { viewsSqlPath } from '@pokemon/db-main';
import pg from 'pg';

import type { ViewsBuilder } from '../../application/ports/ViewsBuilder.ts';
import { STATEMENT_TIMEOUT_MS } from './postgres.ts';

const CONNECTION_TIMEOUT_MS = 10_000;

/** Ejecuta db/main/sql/views.sql, la fuente única de las vistas. */
export class PgViewsBuilder implements ViewsBuilder {
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async build(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const sql = await readFile(viewsSqlPath, 'utf8');
    const client = new pg.Client({
      connectionString: this.connectionString,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      lock_timeout: STATEMENT_TIMEOUT_MS,
    });
    client.on('error', () => undefined); // el error de la consulta ya llega por su promesa
    // Cancelar cierra la conexión: Postgres aborta la consulta y la transacción implícita.
    const cancel = () => void client.end().catch(() => undefined);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await client.connect();
      signal.throwIfAborted();
      // Una sola consulta simple, sin parámetros: admite varias sentencias y no hay
      // que partir por `;` (el archivo tiene uno dentro de un comentario).
      await client.query(sql);
    } catch (error) {
      // Cerrar la conexión hace fallar la consulta con otro error: se informa el motivo.
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      await client.end().catch(() => undefined);
    }
  }
}
