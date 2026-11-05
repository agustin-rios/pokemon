import {
  BadGatewayException,
  Logger,
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

const TIMEOUT_MS = 10_000;

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
    const { access_token } = await this.post('/auth/token', tokenSchema, {
      username: this.config.username,
      password: this.config.password,
    });
    const run = await this.post(
      `/api/v2/dags/${encodeURIComponent(dagId)}/dagRuns`,
      dagRunSchema,
      { logical_date: null },
      access_token,
    );
    return {
      dagId: run.dag_id,
      runId: run.dag_run_id,
      state: run.state,
      queuedAt: run.queued_at,
    };
  }

  private async post<T>(
    path: string,
    schema: z.ZodType<T>,
    body: unknown,
    token?: string,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.config.url}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(
        `POST ${path}: Airflow no responde`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('Airflow no está disponible.');
    }

    const payload: unknown = await res.json().catch(() => null);
    const parsed = schema.safeParse(payload);
    if (!res.ok || !parsed.success) {
      this.logger.error(
        `POST ${path}: Airflow respondió ${res.status}`,
        JSON.stringify(payload),
      );
      throw new BadGatewayException(`Airflow respondió ${res.status}.`);
    }
    return parsed.data;
  }
}
