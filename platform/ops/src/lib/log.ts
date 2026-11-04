const useColor = process.stdout.isTTY && !process.env['NO_COLOR'];
const paint = (code: number) => (text: string) =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : text;

export const bold = paint(1);
export const dim = paint(2);
export const red = paint(31);
export const green = paint(32);
export const yellow = paint(33);
export const cyan = paint(36);

export function info(message: string): void {
  console.log(message);
}

export function ok(message: string): void {
  console.log(`${green('✓')} ${message}`);
}

export function warn(message: string): void {
  console.warn(`${yellow('⚠')} ${message}`);
}

export function error(message: string): void {
  console.error(`${red('✗')} ${message}`);
}

export function kv(
  pairs: Record<string, string | number | null | undefined>,
): void {
  const width = Math.max(...Object.keys(pairs).map((k) => k.length));
  for (const [key, value] of Object.entries(pairs)) {
    console.log(`  ${dim(key.padEnd(width))}  ${value ?? '—'}`);
  }
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function step(title: string): { done: (note?: string) => void } {
  const started = Date.now();
  console.log(`\n${cyan('▸')} ${bold(title)}`);
  return {
    done: (note?: string) =>
      console.log(
        `${green('✓')} ${note ?? title} ${dim(`(${formatDuration(Date.now() - started)})`)}`,
      ),
  };
}
