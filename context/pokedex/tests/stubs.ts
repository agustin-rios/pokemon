import type { PokemonRepository } from '../src/application/ports/PokemonRepository.ts';
import type { ReportsRepository } from '../src/application/ports/ReportsRepository.ts';

/** Repositorios falsos: cada método es un vi.fn() que el test puede configurar. */
export const stubPokemonRepository = () => ({
  list: vi.fn<PokemonRepository['list']>(),
  findById: vi.fn<PokemonRepository['findById']>(),
});

export const stubReportsRepository = () => ({
  typeSummary: vi.fn<ReportsRepository['typeSummary']>(),
  monthlyCaptureGrowth: vi.fn<ReportsRepository['monthlyCaptureGrowth']>(),
  topTrainersByRegion: vi.fn<ReportsRepository['topTrainersByRegion']>(),
  levelClassificationByType:
    vi.fn<ReportsRepository['levelClassificationByType']>(),
});
