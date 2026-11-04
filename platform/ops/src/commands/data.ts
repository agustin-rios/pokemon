import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  flagInt,
  flagString,
  UsageError,
  type ParsedArgs,
} from '../lib/args.ts';
import { toCsv } from '../lib/csv.ts';
import { execInteractive } from '../lib/exec.ts';
import { writeFilesAtomically } from '../lib/files.ts';
import { kv, ok, step } from '../lib/log.ts';
import { DATA_DIR, fromRoot, GENERATOR_SCRIPT } from '../lib/paths.ts';
import {
  fetchPokemon,
  MAX_POKEMON,
  POKEMON_COLUMNS,
  POKEMON_TYPE_COLUMNS,
  toDataset,
  TYPE_COLUMNS,
} from '../lib/pokeapi.ts';
import type { Command, CommandOption } from './command.ts';

// Cada paso produce sus CSV en memoria (nombre → contenido) sin tocar out/;
// save() los escribe juntos y completos. Así un fallo nunca deja out/ a medias.
type CsvFiles = Record<string, string>;

/** Igual al --pokemon por defecto de scripts/generate_pokemon_data.py: ids 1..100. */
const DEFAULT_LIMIT = 100;

/** Lo que escribe scripts/generate_pokemon_data.py. */
const GENERATED_FILES = ['trainers.csv', 'captures.csv', 'battles.csv'];

const LIMIT_OPTION: CommandOption = {
  name: 'limit',
  value: '<n>',
  description: `Pokémon 1..n (default ${DEFAULT_LIMIT}, igual que el generador)`,
};
const OUT_OPTION: CommandOption = {
  name: 'out',
  value: '<dir>',
  description: 'default: data/',
};

const outDir = (args: ParsedArgs) =>
  resolve(flagString(args, 'out') ?? DATA_DIR);
const limitOf = (args: ParsedArgs) =>
  flagInt(args, 'limit', DEFAULT_LIMIT, 1, MAX_POKEMON);

/** PokeAPI → pokemon.csv, types.csv y pokemon_types.csv. */
async function scrapeFiles(limit: number): Promise<CsvFiles> {
  const s = step(`PokeAPI: Pokémon 1–${limit}`);
  const dataset = toDataset(await fetchPokemon(limit));
  s.done(`PokeAPI: ${dataset.pokemon.length} Pokémon`);
  return {
    'pokemon.csv': toCsv(POKEMON_COLUMNS, dataset.pokemon),
    'types.csv': toCsv(TYPE_COLUMNS, dataset.types),
    'pokemon_types.csv': toCsv(POKEMON_TYPE_COLUMNS, dataset.pokemonTypes),
  };
}

/** Corre el generador del desafío con esos ids → trainers, captures y battles. */
async function generateFiles(pokemonCsv: string): Promise<CsvFiles> {
  const s = step('Generador del desafío (semilla fija, tamaños por defecto)');
  const tmp = await mkdtemp(join(tmpdir(), 'pokemon-generate-'));
  try {
    const input = join(tmp, 'pokemon.csv');
    await writeFile(input, pokemonCsv);
    await execInteractive(
      process.env['PYTHON'] ?? 'python3',
      [GENERATOR_SCRIPT, '--out', tmp, '--pokemon-csv', input],
      { label: 'generate_pokemon_data.py' },
    );
    const files: CsvFiles = {};
    for (const name of GENERATED_FILES) {
      files[name] = await readFile(join(tmp, name), 'utf8');
    }
    s.done('Generador: trainers, captures y battles');
    return files;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Filas de datos de un CSV (sin la cabecera). */
const rowCount = (csv: string) => csv.trimEnd().split(/\r?\n/).length - 1;

async function save(out: string, files: CsvFiles): Promise<void> {
  await writeFilesAtomically(out, files);
  ok(`CSV en ${fromRoot(out)}/`);
  kv(
    Object.fromEntries(
      Object.entries(files).map(([name, csv]) => [name, rowCount(csv)]),
    ),
  );
}

export const dataScrape: Command = {
  name: 'data scrape',
  summary: 'PokeAPI → pokemon.csv, types.csv, pokemon_types.csv',
  options: [LIMIT_OPTION, OUT_OPTION],
  async run(args) {
    await save(outDir(args), await scrapeFiles(limitOf(args)));
  },
};

export const dataGenerate: Command = {
  name: 'data generate',
  summary:
    'scripts/generate_pokemon_data.py → trainers.csv, captures.csv, battles.csv',
  options: [
    { ...OUT_OPTION, description: 'default: data/ (usa su pokemon.csv)' },
  ],
  async run(args) {
    const out = outDir(args);
    const pokemonCsv = join(out, 'pokemon.csv');
    if (!existsSync(pokemonCsv)) {
      throw new UsageError(
        `Falta ${fromRoot(pokemonCsv)}: corre antes \`pnpm ops data scrape\` (o \`data prepare\`).`,
      );
    }
    await save(out, await generateFiles(await readFile(pokemonCsv, 'utf8')));
  },
};

export const dataPrepare: Command = {
  name: 'data prepare',
  summary:
    'scrape + generate: los 6 CSV juntos (out/ cambia solo si ambos terminan)',
  options: [LIMIT_OPTION, OUT_OPTION],
  async run(args) {
    const scraped = await scrapeFiles(limitOf(args));
    const pokemonCsv = scraped['pokemon.csv'] ?? '';
    const generated = await generateFiles(pokemonCsv);
    await save(outDir(args), { ...scraped, ...generated });
  },
};
