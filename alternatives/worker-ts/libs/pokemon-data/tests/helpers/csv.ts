// Los CSV de tests/fixtures son datos de referencia (salida del script de Python):
// este lector mínimo no maneja comillas ni comas dentro de las celdas, que no las tienen.
import { readFileSync } from 'node:fs';

export type CsvRow = Record<string, string>;

export function readCsvRows(file: URL | string): CsvRow[] {
  const [header, ...lines] = readFileSync(file, 'utf8')
    .replaceAll('\r\n', '\n')
    .trimEnd()
    .split('\n');
  const columns = header!.split(',');
  return lines.map((line) =>
    Object.fromEntries(line.split(',').map((cell, i) => [columns[i]!, cell])),
  );
}

/** Una fila como texto de CSV: null ⇒ celda vacía. Para comparar con las fixtures. */
export function asCells(row: object): CsvRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value === null ? '' : String(value),
    ]),
  );
}

/** CSV con LF y cabecera (sin escapes: los datos de referencia no los necesitan). */
export function toCsv(columns: readonly string[], rows: readonly object[]) {
  const lines = rows.map((row) =>
    columns.map((c) => asCells(row)[c]).join(','),
  );
  return `${[columns.join(','), ...lines].join('\n')}\n`;
}
