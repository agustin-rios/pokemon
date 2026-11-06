// Port exacto de scripts/generate_pokemon_data.py: con las mismas entradas deja
// las mismas filas que Python (el orden de las llamadas al RNG es parte del contrato).
import { PythonRandom } from './rng.ts';

export const SEED = 42;

export type TrainerRow = {
  id: number;
  name: string;
  region: string;
  /** AAAA-MM-DD */
  created_at: string;
};

export type CaptureRow = {
  id: number;
  trainer_id: number;
  pokemon_id: number;
  /** AAAA-MM-DD HH:MM:SS */
  captured_at: string;
  level: number;
  location: string;
};

export type BattleRow = {
  id: number;
  pokemon_a_id: number;
  pokemon_b_id: number;
  winner_id: number;
  /** AAAA-MM-DD HH:MM:SS */
  fought_at: string;
  duration_seconds: number;
};

export interface GeneratorOptions {
  trainers: number;
  captures: number;
  battles: number;
  months: number;
  /** Primer mes, AAAA-MM-DD. */
  start: string;
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  trainers: 50,
  captures: 5000,
  battles: 2000,
  months: 12,
  start: '2025-11-01',
};

export interface SyntheticData {
  trainers: TrainerRow[];
  captures: CaptureRow[];
  battles: BattleRow[];
}

const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos'];
const REGION_WEIGHTS = [5, 4, 3, 3, 2, 1]; // Kanto domina
const LOCATIONS = [
  'Viridian Forest',
  'Mt. Moon',
  'Cerulean Cave',
  'Safari Zone',
  'Route 1',
  'Route 10',
  'Lavender Town',
  'Seafoam Islands',
  'Victory Road',
  'Pallet Town',
  'Ilex Forest',
  'Petalburg Woods',
  'Eterna Forest',
  'Pinwheel Forest',
];
const FIRST_NAMES = [
  'Ash',
  'Misty',
  'Brock',
  'Gary',
  'May',
  'Dawn',
  'Serena',
  'Clemont',
  'Iris',
  'Cilan',
  'Red',
  'Blue',
  'Leaf',
  'Ethan',
  'Lyra',
  'Brendan',
  'Lucas',
  'Hilda',
  'Nate',
  'Rosa',
  'Calem',
  'Elio',
  'Selene',
  'Gloria',
  'Victor',
  'Juliana',
];
const LAST_NAMES = [
  'Ketchum',
  'Oak',
  'Waterflower',
  'Stone',
  'Berlitz',
  'Rowan',
  'Elm',
  'Birch',
  'Sycamore',
  'Kukui',
  'Magnolia',
  'Sada',
  'Turo',
  'Harrison',
  'Platt',
];

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Las fechas son calendario ingenuo (como datetime de Python sin zona): se
// manejan como milisegundos UTC, así ni la zona horaria ni el DST las alteran.

function parseDate(text: string): number {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? Date.parse(`${text}T00:00:00Z`)
    : NaN;
  // Date.parse acepta fechas que no existen (30 de febrero) y las corre: se descartan.
  if (Number.isNaN(ms) || formatDate(ms) !== text) {
    throw new RangeError(`start debe ser una fecha AAAA-MM-DD válida: ${text}`);
  }
  return ms;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${formatDate(ms)} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** Peso por mes con tendencia creciente y un par de picos (temporada). */
function monthWeights(months: number): number[] {
  const weights: number[] = [];
  for (let i = 0; i < months; i++) {
    let base = 1 + i * 0.12; // tendencia al alza
    if (i === 3 || i === 9) base *= 1.8; // dos meses de evento
    if (i === 6) base *= 0.6; // un mes flojo
    weights.push(base);
  }
  return weights;
}

/** Primer día del mes de `ms` + n meses, sin drift. */
function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
}

function genTrainers(
  n: number,
  start: number,
  rng: PythonRandom,
): TrainerRow[] {
  const trainers: TrainerRow[] = [];
  for (let id = 1; id <= n; id++) {
    const name = `${rng.choice(FIRST_NAMES)} ${rng.choice(LAST_NAMES)}`;
    const region = rng.choiceWeighted(REGIONS, REGION_WEIGHTS);
    const createdAt = start - rng.randint(0, 400) * DAY;
    trainers.push({ id, name, region, created_at: formatDate(createdAt) });
  }
  return trainers;
}

function genCaptures(
  n: number,
  trainers: readonly TrainerRow[],
  pokemonIds: readonly number[],
  start: number,
  months: number,
  rng: PythonRandom,
): CaptureRow[] {
  // Actividad por entrenador sesgada: pocos muy activos, muchos ocasionales.
  const trainerWeights = trainers.map(() => rng.paretovariate(1.5));
  // Popularidad por pokémon sesgada también.
  const pokemonWeights = pokemonIds.map(() => rng.paretovariate(2.0));
  const monthIndexes = Array.from({ length: months }, (_, i) => i);
  const monthWeightList = monthWeights(months);
  const firstMonth = addMonths(start, 0);

  const captures: CaptureRow[] = [];
  for (let id = 1; id <= n; id++) {
    const trainer = rng.choiceWeighted(trainers, trainerWeights);
    const pokemonId = rng.choiceWeighted(pokemonIds, pokemonWeights);
    const monthIndex = rng.choiceWeighted(monthIndexes, monthWeightList);
    const days = rng.randint(0, 27);
    const hours = rng.randint(0, 23);
    const minutes = rng.randint(0, 59);
    const capturedAt =
      addMonths(firstMonth, monthIndex) +
      days * DAY +
      hours * HOUR +
      minutes * MINUTE;
    // Nivel sesgado hacia abajo, con cola larga.
    const level = Math.min(
      100,
      Math.max(1, Math.trunc(rng.expovariate(1 / 25)) + 1),
    );
    captures.push({
      id,
      trainer_id: trainer.id,
      pokemon_id: pokemonId,
      captured_at: formatTimestamp(capturedAt),
      level,
      location: rng.choice(LOCATIONS),
    });
  }
  return renumberByDate(captures, (c) => c.captured_at);
}

function genBattles(
  n: number,
  pokemonIds: readonly number[],
  start: number,
  months: number,
  rng: PythonRandom,
): BattleRow[] {
  const span = months * 30 * (DAY / SECOND);
  const maxId = Math.max(...pokemonIds);

  const battles: BattleRow[] = [];
  for (let id = 1; id <= n; id++) {
    const [a, b] = rng.sample(pokemonIds, 2) as [number, number];
    // Pokémon con id más alto gana un poco más seguido (correlación débil).
    const pAWins = 0.5 + 0.2 * ((a - b) / maxId);
    const winner = rng.random() < pAWins ? a : b;
    const foughtAt = start + rng.randint(0, span) * SECOND;
    // Se sortea la condición antes del gauss, igual que Python.
    const duration =
      rng.random() > 0.05 ? rng.gauss(180, 60) : rng.gauss(600, 120);
    // int() de Python nunca da -0; el "+ 0" lo normaliza.
    battles.push({
      id,
      pokemon_a_id: a,
      pokemon_b_id: b,
      winner_id: winner,
      fought_at: formatTimestamp(foughtAt),
      duration_seconds: Math.trunc(duration) + 0,
    });
  }
  return renumberByDate(battles, (b) => b.fought_at);
}

/** Orden estable por fecha (texto) y ids 1..n reasignados en ese orden. */
function renumberByDate<T extends { id: number }>(
  rows: T[],
  date: (row: T) => string,
): T[] {
  rows.sort((x, y) => {
    const dx = date(x);
    const dy = date(y);
    return dx < dy ? -1 : dx > dy ? 1 : 0;
  });
  rows.forEach((row, i) => {
    row.id = i + 1;
  });
  return rows;
}

/**
 * Entrenadores, capturas y batallas sintéticos. `pokemonIds` debe traer al menos
 * 2 ids (las batallas enfrentan a dos distintos); el resultado depende del orden.
 */
export function generateSyntheticData(
  pokemonIds: readonly number[],
  options: Partial<GeneratorOptions> = {},
): SyntheticData {
  const { trainers, captures, battles, months, start } = {
    ...DEFAULT_GENERATOR_OPTIONS,
    ...options,
  };
  if (pokemonIds.length < 2) {
    throw new RangeError('Se necesitan al menos 2 ids de Pokémon');
  }
  for (const [name, value] of Object.entries({ trainers, captures, battles })) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${name} debe ser un entero >= 0`);
    }
  }
  if (!Number.isInteger(months) || months < 1) {
    throw new RangeError('months debe ser un entero >= 1');
  }
  const startMs = parseDate(start);

  // Un solo RNG para toda la corrida, en este orden.
  const rng = new PythonRandom(SEED);
  const trainerRows = genTrainers(trainers, startMs, rng);
  return {
    trainers: trainerRows,
    captures: genCaptures(
      captures,
      trainerRows,
      pokemonIds,
      startMs,
      months,
      rng,
    ),
    battles: genBattles(battles, pokemonIds, startMs, months, rng),
  };
}
