import { resolve } from 'node:path';
import { flagInt, flagString } from '../lib/args.ts';
import { toCsv } from '../lib/csv.ts';
import { writeFilesAtomically } from '../lib/files.ts';
import { kv, step } from '../lib/log.ts';
import { DATA_DIR, fromRoot } from '../lib/paths.ts';
import {
  fetchPokemon,
  MAX_POKEMON,
  POKEMON_COLUMNS,
  POKEMON_TYPE_COLUMNS,
  toDataset,
  TYPE_COLUMNS,
} from '../lib/pokeapi.ts';
import type { Command } from './command.ts';

/** Igual al --pokemon por defecto de scripts/generate_pokemon_data.py: ids 1..100. */
const DEFAULT_LIMIT = 100;

export const dataScrape: Command = {
  name: 'data scrape',
  summary: 'PokeAPI → pokemon.csv, types.csv, pokemon_types.csv',
  options: [
    {
      name: 'limit',
      value: '<n>',
      description: `Pokémon 1..n (default ${DEFAULT_LIMIT}, igual que el generador)`,
    },
    { name: 'out', value: '<dir>', description: 'default: data/' },
  ],
  async run(args) {
    const limit = flagInt(args, 'limit', DEFAULT_LIMIT, 1, MAX_POKEMON);
    const out = resolve(flagString(args, 'out') ?? DATA_DIR);

    const s = step(`PokeAPI: Pokémon 1–${limit}`);
    // Todo en memoria (son ~100 filas): si la API falla, no se escribe nada.
    const dataset = toDataset(await fetchPokemon(limit));
    await writeFilesAtomically(out, {
      'pokemon.csv': toCsv(POKEMON_COLUMNS, dataset.pokemon),
      'types.csv': toCsv(TYPE_COLUMNS, dataset.types),
      'pokemon_types.csv': toCsv(POKEMON_TYPE_COLUMNS, dataset.pokemonTypes),
    });
    s.done(`CSV en ${fromRoot(out)}/`);
    kv({
      'pokemon.csv': dataset.pokemon.length,
      'types.csv': dataset.types.length,
      'pokemon_types.csv': dataset.pokemonTypes.length,
    });
  },
};
