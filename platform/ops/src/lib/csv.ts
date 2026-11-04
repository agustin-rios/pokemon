export type Cell = string | number | null | undefined;

function escape(value: Cell): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV con cabecera; las columnas fijan el orden. null/undefined → celda vacía. */
export function toCsv<T extends Record<string, Cell>>(
  columns: readonly (keyof T & string)[],
  rows: readonly T[],
): string {
  const lines = [
    columns.join(','),
    ...rows.map((row) =>
      columns.map((column) => escape(row[column])).join(','),
    ),
  ];
  return `${lines.join('\n')}\n`;
}
