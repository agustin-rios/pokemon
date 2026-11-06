import { readFileSync } from 'node:fs';
import {
  LOAD_ORDER,
  TABLES,
  UNIQUE,
  type Row,
  type StagingRows,
  type TableName,
  type Value,
} from '../src/index.ts';

/**
 * Los CSV de tests/fixtures/data-current son los datos de la corrida de referencia
 * (los que dejó el pipeline original). Este lector mínimo los pasa a filas de staging;
 * no maneja comillas ni comas dentro de las celdas, que no las tienen.
 */
function readTable(table: TableName): Row[] {
  const [header, ...lines] = readFileSync(
    new URL(`./fixtures/data-current/${table}.csv`, import.meta.url),
    'utf8',
  )
    .replaceAll('\r\n', '\n')
    .trimEnd()
    .split('\n');
  // En el CSV la columna del sprite se llama `sprite`; en la tabla, `sprite_url`.
  const names = header!
    .split(',')
    .map((name) => name.replace(/^sprite$/, 'sprite_url'));
  const rows = lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(
      TABLES[table].map(({ name, kind }): [string, Value] => {
        const cell = cells[names.indexOf(name)] ?? '';
        if (cell === '') return [name, null];
        return [
          name,
          kind === 'integer' || kind === 'smallint' ? Number(cell) : cell,
        ];
      }),
    );
  });
  // Como los entrega staging: ordenados por clave.
  const key = UNIQUE[table][0] ?? [];
  return rows.sort((a, b) => {
    for (const column of key) {
      const diff = (a[column] as number) - (b[column] as number);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

/** Las 6 tablas de la corrida de referencia, como las lee staging. */
export function referenceRows(): Record<TableName, Row[]> {
  return Object.fromEntries(
    LOAD_ORDER.map((table) => [table, readTable(table)]),
  ) as Record<TableName, Row[]>;
}

export type MutableRows = Record<TableName, Record<string, Value>[]>;

/** Dataset mínimo válido: 2 tipos, 2 Pokémon (uno con dos tipos), 2 entrenadores. */
export function validRows(): MutableRows {
  return {
    types: [
      { id: 1, name: 'normal' },
      { id: 3, name: 'flying' },
    ],
    pokemon: [
      {
        id: 16,
        name: 'pidgey',
        height: 3,
        weight: 18,
        base_experience: 50,
        sprite_url: 'https://img/16.png',
      },
      {
        id: 19,
        name: 'rattata',
        height: 3,
        weight: 35,
        base_experience: null,
        sprite_url: null,
      },
    ],
    pokemon_types: [
      { pokemon_id: 16, type_id: 1, slot: 1 },
      { pokemon_id: 16, type_id: 3, slot: 2 },
      { pokemon_id: 19, type_id: 1, slot: 1 },
    ],
    trainers: [
      { id: 1, name: 'Ash Ketchum', region: 'Kanto', created_at: '2025-01-02' },
      {
        id: 2,
        name: 'Misty Waterflower',
        region: 'Kanto',
        created_at: '2025-03-04',
      },
    ],
    captures: [
      {
        id: 1,
        trainer_id: 1,
        pokemon_id: 16,
        captured_at: '2025-11-01 02:22:00',
        level: 12,
        location: 'Route 1',
      },
      {
        id: 2,
        trainer_id: 2,
        pokemon_id: 19,
        captured_at: '2025-12-05 10:00:00',
        level: 50,
        location: 'Route 10',
      },
    ],
    battles: [
      {
        id: 1,
        pokemon_a_id: 16,
        pokemon_b_id: 19,
        winner_id: 19,
        fought_at: '2025-11-02 08:30:54',
        duration_seconds: 120,
      },
    ],
  };
}

/** Lo que dejó la corrida de referencia en las tablas finales (checksum por tabla). */
export const REFERENCE_CHECKSUM =
  'types=16:9cd5bd13 pokemon=100:143cf1f5 pokemon_types=148:68d4999e trainers=50:3f0d0ce2 captures=5000:5e25ca6a battles=1996:be06adb5';

export type { StagingRows };
