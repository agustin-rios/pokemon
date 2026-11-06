import { DataValidationError } from '../errors.ts';
import {
  DISCARDABLE,
  FOREIGN_KEYS,
  LOAD_ORDER,
  RULES,
  TABLES,
  UNIQUE,
  type DiscardableTable,
  type Row,
  type StagingRows,
  type TableName,
  type Value,
} from './tables.ts';

export interface ValidatedDataset {
  /** Filas leídas por tabla (todas son válidas: si no, no hay resultado). */
  readonly counts: Readonly<Record<TableName, number>>;
  /** Por tabla, solo las que descartaron filas: «battles id 171: duration_seconds debe ser >= 0». */
  readonly discarded: Readonly<Partial<Record<TableName, string[]>>>;
  /** Ids de las filas descartadas, para excluirlas al cargar. */
  readonly discardedIds: Readonly<Record<DiscardableTable, readonly number[]>>;
}

/** NULL como `NULL`, texto entre comillas dobles con escapes de JSON, números tal cual. */
const show = (value: Value | undefined): string =>
  value === null || value === undefined
    ? 'NULL'
    : typeof value === 'string'
      ? JSON.stringify(value)
      : String(value);

const label = (table: TableName, row: Row): string =>
  table === 'pokemon_types'
    ? `pokemon_types (${show(row['pokemon_id'])}, ${show(row['type_id'])})`
    : `${table} id ${show(row['id'])}`;

const isBlank = (text: string): boolean => /^\p{White_Space}*$/u.test(text);

/**
 * Valida las filas de staging (leídas ordenadas por clave, con los NULL al final) y
 * devuelve lo que se descarta. Lanza DataValidationError con todos los problemas.
 * Las comprobaciones van en este orden: tablas vacías, valores requeridos, claves
 * únicas, referencias, reglas y orden de los slots.
 */
export function validateStaging(rows: StagingRows): ValidatedDataset {
  const errors: string[] = [];

  for (const table of LOAD_ORDER) {
    if (rows[table].length === 0) errors.push(`${table}: no tiene filas`);
  }

  const valid = checkRequired(rows, errors);
  checkUnique(valid, errors);
  checkReferences(valid, errors);
  const discarded = checkRules(valid, errors);
  checkSlotOrder(valid, errors);
  if (errors.length > 0) throw new DataValidationError(errors);

  return {
    counts: Object.fromEntries(
      LOAD_ORDER.map((table) => [table, rows[table].length]),
    ) as Record<TableName, number>,
    discarded: Object.fromEntries(
      DISCARDABLE.filter((table) => discarded[table].length > 0).map(
        (table) => [table, discarded[table].map(({ reason }) => reason)],
      ),
    ),
    discardedIds: {
      captures: discarded.captures.map(({ id }) => id),
      battles: discarded.battles.map(({ id }) => id),
    },
  };
}

type Tables = Record<TableName, readonly Row[]>;

/** Un error por fila (el de la primera columna que falla); esa fila no sigue a las demás comprobaciones. */
function checkRequired(rows: StagingRows, errors: string[]): Tables {
  const valid = {} as Record<TableName, Row[]>;
  for (const table of LOAD_ORDER) {
    valid[table] = [];
    for (const row of rows[table]) {
      const failing = TABLES[table].find(({ name, required, notBlank }) => {
        const value = row[name];
        if (required && (value === null || value === undefined)) return true;
        return notBlank && typeof value === 'string' && isBlank(value);
      });
      if (failing) errors.push(`${label(table, row)}: ${failing.name} vacío`);
      else valid[table].push(row);
    }
  }
  return valid;
}

function checkUnique(rows: Tables, errors: string[]): void {
  for (const table of LOAD_ORDER) {
    for (const key of UNIQUE[table]) {
      const seen = new Map<string, { values: Value[]; times: number }>();
      for (const row of rows[table]) {
        const values = key.map((name) => row[name] ?? null);
        const id = JSON.stringify(values);
        const entry = seen.get(id);
        if (entry) entry.times++;
        else seen.set(id, { values, times: 1 });
      }
      for (const { values, times } of seen.values()) {
        if (times < 2) continue;
        const shown =
          key.length === 1
            ? `${key[0]} ${show(values[0])}`
            : `(${key.join(', ')}) (${values.map(show).join(', ')})`;
        errors.push(`${table}: ${shown} repetido (${times} veces)`);
      }
    }
  }
}

function checkReferences(rows: Tables, errors: string[]): void {
  const ids = new Map<TableName, Set<Value | undefined>>();
  for (const { references } of FOREIGN_KEYS) {
    if (!ids.has(references)) {
      ids.set(references, new Set(rows[references].map((row) => row['id'])));
    }
  }
  for (const { table, column, references } of FOREIGN_KEYS) {
    for (const row of rows[table]) {
      if (!ids.get(references)?.has(row[column])) {
        errors.push(
          `${label(table, row)}: ${column} ${show(row[column])} no existe en ${references}`,
        );
      }
    }
  }
}

/** Aplica RULES: error en el catálogo, fila descartada en captures y battles. */
function checkRules(
  rows: Tables,
  errors: string[],
): Record<DiscardableTable, { id: number; reason: string }[]> {
  const discarded: Record<DiscardableTable, { id: number; reason: string }[]> =
    { captures: [], battles: [] };
  for (const table of LOAD_ORDER) {
    const rules = RULES[table] ?? [];
    for (const row of rows[table]) {
      const reasons = rules
        .filter(({ holds }) => !holds(row))
        .map(({ message }) => message)
        .join('; ');
      if (reasons === '') continue;
      const text = `${label(table, row)}: ${reasons}`;
      if (table === 'captures' || table === 'battles') {
        discarded[table].push({ id: row['id'] as number, reason: text });
      } else {
        errors.push(text);
      }
    }
  }
  return discarded;
}

/** El slot 2 exige que el mismo Pokémon tenga slot 1 (constraint trigger en la base). */
function checkSlotOrder(rows: Tables, errors: string[]): void {
  const withFirstSlot = new Set(
    rows.pokemon_types
      .filter((row) => row['slot'] === 1)
      .map((row) => row['pokemon_id']),
  );
  for (const row of rows.pokemon_types) {
    if (row['slot'] === 2 && !withFirstSlot.has(row['pokemon_id'])) {
      errors.push(
        `${label('pokemon_types', row)}: el Pokémon ${show(row['pokemon_id'])} tiene slot 2 sin slot 1`,
      );
    }
  }
}
