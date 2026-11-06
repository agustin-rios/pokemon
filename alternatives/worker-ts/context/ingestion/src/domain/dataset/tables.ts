/**
 * Forma de las 6 tablas de staging y reglas de lo que se puede cargar. Siguen a las
 * tablas y constraints de db/main (migraciones de Prisma):
 *
 * - Error (la corrida falla y las tablas finales no se tocan): una tabla vacía; un
 *   valor vacío; una clave única repetida; una referencia a un id que no existe; una
 *   regla rota en el catálogo (types, pokemon, pokemon_types, trainers), del que
 *   dependen las demás tablas.
 * - Fila descartada (se informa y la corrida sigue): una regla rota en captures o
 *   battles. Ninguna tabla las referencia, así que sacar la fila no rompe nada.
 */

/** Valor de una celda de staging; fechas y horas llegan como texto. */
export type Value = number | string | null;
export type Row = Readonly<Record<string, Value>>;

export const LOAD_ORDER = [
  'types',
  'pokemon',
  'pokemon_types',
  'trainers',
  'captures',
  'battles',
] as const;
export type TableName = (typeof LOAD_ORDER)[number];

/** Las filas de las 6 tablas de staging, en el orden de lectura. */
export type StagingRows = Readonly<Record<TableName, readonly Row[]>>;

export type ColumnKind = 'integer' | 'smallint' | 'text' | 'date' | 'timestamp';

export interface Column {
  readonly name: string;
  readonly kind: ColumnKind;
  /** No puede ser NULL. */
  readonly required: boolean;
  /** Además de no ser NULL, no puede ser vacío ni solo espacios. */
  readonly notBlank: boolean;
}

const column = (
  name: string,
  kind: ColumnKind,
  options: { optional?: boolean; notBlank?: boolean } = {},
): Column => ({
  name,
  kind,
  required: !options.optional,
  notBlank: options.notBlank ?? false,
});

/** Una entrada por tabla, en orden de carga (primero las referenciadas por FK). */
export const TABLES: Readonly<Record<TableName, readonly Column[]>> = {
  types: [column('id', 'integer'), column('name', 'text', { notBlank: true })],
  pokemon: [
    column('id', 'integer'),
    column('name', 'text', { notBlank: true }),
    column('height', 'integer'),
    column('weight', 'integer'),
    // La PokeAPI lo trae null en algunos Pokémon: se carga como 0, el default de la columna.
    column('base_experience', 'integer', { optional: true }),
    column('sprite_url', 'text', { optional: true }),
  ],
  pokemon_types: [
    column('pokemon_id', 'integer'),
    column('type_id', 'integer'),
    column('slot', 'smallint'),
  ],
  trainers: [
    column('id', 'integer'),
    column('name', 'text', { notBlank: true }),
    column('region', 'text', { notBlank: true }),
    column('created_at', 'date'),
  ],
  captures: [
    column('id', 'integer'),
    column('trainer_id', 'integer'),
    column('pokemon_id', 'integer'),
    column('captured_at', 'timestamp'),
    column('level', 'integer'),
    column('location', 'text', { notBlank: true }),
  ],
  battles: [
    column('id', 'integer'),
    column('pokemon_a_id', 'integer'),
    column('pokemon_b_id', 'integer'),
    column('winner_id', 'integer'),
    column('fought_at', 'timestamp'),
    column('duration_seconds', 'integer'),
  ],
};

/**
 * Clave primaria y claves únicas de cada tabla. La primera es también el orden en
 * que se leen las filas de staging.
 */
export const UNIQUE: Readonly<
  Record<TableName, readonly (readonly string[])[]>
> = {
  types: [['id'], ['name']],
  pokemon: [['id'], ['name']],
  pokemon_types: [
    ['pokemon_id', 'type_id'],
    ['pokemon_id', 'slot'],
  ],
  trainers: [['id']],
  captures: [['id']],
  battles: [['id']],
};

export interface ForeignKey {
  readonly table: TableName;
  readonly column: string;
  /** Tabla cuyo id referencia la columna. */
  readonly references: TableName;
}

export const FOREIGN_KEYS: readonly ForeignKey[] = [
  { table: 'pokemon_types', column: 'pokemon_id', references: 'pokemon' },
  { table: 'pokemon_types', column: 'type_id', references: 'types' },
  { table: 'captures', column: 'trainer_id', references: 'trainers' },
  { table: 'captures', column: 'pokemon_id', references: 'pokemon' },
  { table: 'battles', column: 'pokemon_a_id', references: 'pokemon' },
  { table: 'battles', column: 'pokemon_b_id', references: 'pokemon' },
  { table: 'battles', column: 'winner_id', references: 'pokemon' },
];

export interface Rule {
  /** Mensaje si se rompe. */
  readonly message: string;
  /** Condición que debe cumplirse (las columnas requeridas ya no son NULL). */
  readonly holds: (row: Row) => boolean;
}

const int = (row: Row, name: string): number => row[name] as number;

/** Reglas por fila: los CHECK de la base. */
export const RULES: Readonly<Partial<Record<TableName, readonly Rule[]>>> = {
  pokemon: [
    { message: 'height debe ser > 0', holds: (r) => int(r, 'height') > 0 },
    { message: 'weight debe ser > 0', holds: (r) => int(r, 'weight') > 0 },
    {
      message: 'base_experience debe ser >= 0',
      // NULL cuenta como 0.
      holds: (r) => ((r['base_experience'] as number | null) ?? 0) >= 0,
    },
  ],
  pokemon_types: [
    {
      message: 'slot debe ser 1 o 2',
      holds: (r) => int(r, 'slot') === 1 || int(r, 'slot') === 2,
    },
  ],
  captures: [
    {
      message: 'level debe estar entre 1 y 100',
      holds: (r) => int(r, 'level') >= 1 && int(r, 'level') <= 100,
    },
  ],
  battles: [
    {
      message: 'pokemon_a_id y pokemon_b_id deben ser distintos',
      holds: (r) => int(r, 'pokemon_a_id') !== int(r, 'pokemon_b_id'),
    },
    {
      message: 'winner_id debe ser pokemon_a_id o pokemon_b_id',
      holds: (r) =>
        int(r, 'winner_id') === int(r, 'pokemon_a_id') ||
        int(r, 'winner_id') === int(r, 'pokemon_b_id'),
    },
    {
      message: 'duration_seconds debe ser >= 0',
      holds: (r) => int(r, 'duration_seconds') >= 0,
    },
  ],
};

/** Tablas donde romper una regla descarta la fila en vez de fallar. */
export const DISCARDABLE = ['captures', 'battles'] as const;
export type DiscardableTable = (typeof DISCARDABLE)[number];
