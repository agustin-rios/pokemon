const decimal = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
const monthYear = new Intl.DateTimeFormat('es', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "mr-mime" → "Mr Mime". */
export const pokemonName = (name: string) =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

/** 25 → "#025". */
export const pokemonNumber = (id: number) => `#${String(id).padStart(3, '0')}`;

/** La PokeAPI da la altura en decímetros. */
export const meters = (decimeters: number) =>
  `${decimal.format(decimeters / 10)} m`;

/** La PokeAPI da el peso en hectogramos. */
export const kilograms = (hectograms: number) =>
  `${decimal.format(hectograms / 10)} kg`;

export const number = (value: number) => decimal.format(value);

export const percent = (value: number) => `${decimal.format(value)} %`;

/** "2025-11" → "noviembre de 2025". */
export function month(yearMonth: string): string {
  const [year, monthIndex] = yearMonth.split('-').map(Number);
  if (!year || !monthIndex) return yearMonth;
  return monthYear.format(new Date(Date.UTC(year, monthIndex - 1, 1)));
}
