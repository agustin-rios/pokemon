// Los tipos de las respuestas son los del dominio que devuelve la API: se importan
// solo como tipos (no entran al bundle), así web y API comparten el contrato.
import type {
  LevelClassification,
  MonthlyCaptureGrowth,
  Page,
  Pokemon,
  TopTrainer,
  TypeSummary,
} from '@pokemon/context-pokedex';
import { request } from './client.ts';

export type {
  LevelClassification,
  MonthlyCaptureGrowth,
  Page,
  Pokemon,
  TopTrainer,
  TypeSummary,
};

/** Corrida del DAG de carga encolada por POST /etl/runs. */
export interface EtlRun {
  dagId: string;
  runId: string;
  state: string;
  queuedAt: string | null;
}

/**
 * Acceso a la API (Repository Pattern): los thunks dependen de este contrato,
 * no de fetch. En la app se usa httpPokedexApi; en los tests, una versión falsa.
 */
export interface PokedexApi {
  health(signal?: AbortSignal): Promise<{ status: 'ok' }>;
  listPokemon(
    query: { page: number; pageSize: number },
    signal?: AbortSignal,
  ): Promise<Page<Pokemon>>;
  getPokemon(id: number, signal?: AbortSignal): Promise<Pokemon>;
  getTypeSummary(signal?: AbortSignal): Promise<TypeSummary[]>;
  getMonthlyGrowth(signal?: AbortSignal): Promise<MonthlyCaptureGrowth[]>;
  getTopTrainers(signal?: AbortSignal): Promise<TopTrainer[]>;
  getLevelClassification(signal?: AbortSignal): Promise<LevelClassification[]>;
  triggerEtl(signal?: AbortSignal): Promise<EtlRun>;
}

export const httpPokedexApi: PokedexApi = {
  health: (signal) => request('/health', { signal }),
  listPokemon: ({ page, pageSize }, signal) =>
    request(`/items?page=${page}&pageSize=${pageSize}`, { signal }),
  getPokemon: (id, signal) => request(`/items/${id}`, { signal }),
  getTypeSummary: (signal) => request('/items/summary', { signal }),
  getMonthlyGrowth: (signal) => request('/reports/monthly-growth', { signal }),
  getTopTrainers: (signal) => request('/reports/top-trainers', { signal }),
  getLevelClassification: (signal) =>
    request('/reports/level-classification', { signal }),
  triggerEtl: (signal) => request('/etl/runs', { method: 'POST', signal }),
};
