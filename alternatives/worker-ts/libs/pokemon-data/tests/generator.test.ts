import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateSyntheticData } from '../src/index.ts';
import { asCells, readCsvRows, toCsv } from './helpers/csv.ts';

const TRAINER_COLUMNS = ['id', 'name', 'region', 'created_at'];
const CAPTURE_COLUMNS = [
  'id',
  'trainer_id',
  'pokemon_id',
  'captured_at',
  'level',
  'location',
];
const BATTLE_COLUMNS = [
  'id',
  'pokemon_a_id',
  'pokemon_b_id',
  'winner_id',
  'fought_at',
  'duration_seconds',
];

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

const fixture = (set: string, table: string) =>
  readCsvRows(new URL(`./fixtures/${set}/${table}.csv`, import.meta.url));

describe('generador sintético vs scripts/generate_pokemon_data.py', () => {
  it('gen-small (30 pokémon, 5 entrenadores, 40 capturas, 20 batallas, 3 meses)', () => {
    const out = generateSyntheticData(ids(30), {
      trainers: 5,
      captures: 40,
      battles: 20,
      months: 3,
    });
    for (const table of ['trainers', 'captures', 'battles'] as const) {
      expect(out[table].map(asCells)).toEqual(fixture('gen-small', table));
    }
  });

  it('gen-pool (10 pokémon ⇒ sample por pool, otra fecha de inicio)', () => {
    const out = generateSyntheticData(ids(10), {
      trainers: 3,
      captures: 12,
      battles: 15,
      months: 2,
      start: '2026-01-15',
    });
    for (const table of ['trainers', 'captures', 'battles'] as const) {
      expect(out[table].map(asCells)).toEqual(fixture('gen-pool', table));
    }
  });

  it('gen-default (100 pokémon, valores por defecto): sha256 del CSV con LF', () => {
    const data = generateSyntheticData(ids(100));
    const out = {
      trainers: toCsv(TRAINER_COLUMNS, data.trainers),
      captures: toCsv(CAPTURE_COLUMNS, data.captures),
      battles: toCsv(BATTLE_COLUMNS, data.battles),
    };
    const sha = (text: string) =>
      createHash('sha256').update(text).digest('hex');
    expect(sha(out.trainers)).toBe(
      '6db2f840da3a2ff4cda10ccdf677c76b193d24c6e755935546f1a0ce29168f30',
    );
    expect(sha(out.captures)).toBe(
      '42fea6ba21f459e8b7aa3d5d61c8c721563b3188748b825081580e6cfc58fb40',
    );
    expect(sha(out.battles)).toBe(
      'e2123e6a481934196653be4f0a39388d23505c1aa1b1e5fcf48c7255fa057141',
    );
  });

  it('es determinista y los ids de capturas y batallas quedan 1..n por fecha', () => {
    const a = generateSyntheticData(ids(30), { captures: 100, battles: 50 });
    expect(
      generateSyntheticData(ids(30), { captures: 100, battles: 50 }),
    ).toEqual(a);
    expect(a.captures.map((c) => c.id)).toEqual(ids(100));
    expect(a.battles.map((b) => b.id)).toEqual(ids(50));
    const dates = a.captures.map((c) => c.captured_at);
    expect(dates).toEqual([...dates].sort());
  });

  it('valida las entradas', () => {
    expect(() => generateSyntheticData([1])).toThrow(RangeError);
    expect(() => generateSyntheticData(ids(5), { months: 0 })).toThrow(
      RangeError,
    );
    expect(() => generateSyntheticData(ids(5), { captures: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      generateSyntheticData(ids(5), { start: '2025-02-30' }),
    ).toThrow(RangeError);
  });
});
