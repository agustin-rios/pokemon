import { generateSyntheticData } from '@pokemon/pokemon-data';
import { PermanentError } from '../../domain/index.ts';
import type { StagingStore } from '../ports/StagingStore.ts';
import type { StepContext } from '../ports/StepContext.ts';

export interface GenerateOutput {
  readonly trainers: number;
  readonly captures: number;
  readonly battles: number;
}

/** Paso `generate`: entrenadores, capturas y batallas sintéticos a partir de los ids de staging.pokemon. */
export class GenerateSyntheticData {
  private readonly staging: StagingStore;

  constructor(staging: StagingStore) {
    this.staging = staging;
  }

  async execute(context: StepContext): Promise<GenerateOutput> {
    const ids = await this.staging.findPokemonIds();
    if (ids.length < 2) {
      throw new PermanentError(
        'se necesitan al menos 2 Pokémon en staging.pokemon',
      );
    }
    context.signal.throwIfAborted();
    const data = generateSyntheticData(ids);
    await this.staging.replaceGenerated(data, context);
    return {
      trainers: data.trainers.length,
      captures: data.captures.length,
      battles: data.battles.length,
    };
  }
}
