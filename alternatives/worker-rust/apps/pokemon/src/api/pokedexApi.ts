// Los tipos de las respuestas se generan desde las structs de Rust (ts-rs, `pnpm gen:types`):
// se importan solo como tipos (no entran al bundle), así web y API comparten el contrato.
import type { EtlRun } from './generated/EtlRun';
import type { LevelClassification } from './generated/LevelClassification';
import type { MonthlyCaptureGrowth } from './generated/MonthlyCaptureGrowth';
import type { Page } from './generated/Page';
import type { Pokemon } from './generated/Pokemon';
import type { TopTrainer } from './generated/TopTrainer';
import type { TypeSummary } from './generated/TypeSummary';
import { request } from './client.ts';

export type {
  EtlRun,
  LevelClassification,
  MonthlyCaptureGrowth,
  Page,
  Pokemon,
  TopTrainer,
  TypeSummary,
};

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
