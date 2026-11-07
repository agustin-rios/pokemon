import {
  BadGatewayException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';

export interface AirflowConfig {
  /** Sin `/` al final, p. ej. `http://localhost:8080`. */
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

/** Corrida de un DAG recién encolada. */
export interface DagRun {
  readonly dagId: string;
  readonly runId: string;
  /** Estado al dispararla; normalmente `queued`. */
  readonly state: string;
  readonly queuedAt: string | null;
}

const tokenSchema = z.object({ access_token: z.string().min(1) });
const dagRunSchema = z.object({
  dag_id: z.string(),
  dag_run_id: z.string(),
  state: z.string(),
  queued_at: z.string().nullable(),
});
const clearedSchema = z.object({ total_entries: z.number() });

type DagRunPayload = z.output<typeof dagRunSchema>;

interface RequestOptions {
  readonly body?: unknown;
  readonly token?: string;
  /** Error a lanzar si Airflow responde 404 (en vez de 502). */
  readonly notFound?: () => HttpException;
}

const TIMEOUT_MS = 10_000;

const toDagRun = (run: DagRunPayload): DagRun => ({
  dagId: run.dag_id,
  runId: run.dag_run_id,
  state: run.state,
  queuedAt: run.queued_at,
});

/**
 * Cliente mínimo de la API REST v2 de Airflow 3. Pide un JWT con usuario y
 * clave en cada llamada (las corridas se disparan a mano, no hace falta cachearlo).
 * Airflow caído → 503; Airflow responde un error → 502.
 */
export class AirflowClient {
  private readonly logger = new Logger(AirflowClient.name);

  constructor(private readonly config: AirflowConfig) {}

  /** Encola una corrida del DAG; no espera a que termine. */
  async triggerDag(dagId: string): Promise<DagRun> {
    const token = await this.token();
    const run = await this.request(
      'POST',
      `/api/v2/dags/${encodeURIComponent(dagId)}/dagRuns`,
      dagRunSchema,
      { body: { logical_date: null }, token },
    );
    return toDagRun(run);
  }

  /**
   * Retoma una corrida desde sus tareas fallidas: las limpia (y las que dependen
   * de ellas) para que Airflow las vuelva a correr. Las que ya terminaron bien no
   * se repiten. 404 si la corrida no existe; 409 si no tiene tareas fallidas.
   */
  async retryDagRun(dagId: string, runId: string): Promise<DagRun> {
    const token = await this.token();
    const dag = `/api/v2/dags/${encodeURIComponent(dagId)}`;
    const notFound = () =>
      new NotFoundException(`No existe la corrida ${runId}`);
    const cleared = await this.request(
      'POST',
      `${dag}/clearTaskInstances`,
      clearedSchema,
      {
        body: {
          dry_run: false, // en Airflow el default es true: sin esto no limpia nada
          dag_run_id: runId,
          only_failed: true,
          include_downstream: true,
          reset_dag_runs: true,
        },
        token,
        notFound,
      },
    );
    if (cleared.total_entries === 0) {
      throw new ConflictException(
        'La corrida no tiene tareas fallidas para reintentar',
      );
    }
    const run = await this.request(
      'GET',
      `${dag}/dagRuns/${encodeURIComponent(runId)}`,
      dagRunSchema,
      { token, notFound },
    );
    return toDagRun(run);
  }

  private async token(): Promise<string> {
    const { access_token } = await this.request(
      'POST',
      '/auth/token',
      tokenSchema,
      {
        body: {
          username: this.config.username,
          password: this.config.password,
        },
      },
    );
    return access_token;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: z.ZodType<T>,
    { body, token, notFound }: RequestOptions,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.config.url}${path}`, {
        method,
        headers: {
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(
        `${method} ${path}: Airflow no responde`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('Airflow no está disponible.');
    }

    const payload: unknown = await res.json().catch(() => null);
    if (res.status === 404 && notFound) throw notFound();
    const parsed = schema.safeParse(payload);
    if (!res.ok || !parsed.success) {
      this.logger.error(
        `${method} ${path}: Airflow respondió ${res.status}`,
        JSON.stringify(payload),
      );
      throw new BadGatewayException(`Airflow respondió ${res.status}.`);
    }
    return parsed.data;
  }
}
