export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface ArgSpec {
  booleans?: readonly string[];
  strings?: readonly string[];
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[], spec: ArgSpec): ParsedArgs {
  const booleans = new Set(spec.booleans ?? []);
  const strings = new Set(spec.strings ?? []);
  const result: ParsedArgs = { positionals: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('--')) {
      result.positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (booleans.has(name)) {
      if (eq !== -1) throw new UsageError(`--${name} no lleva valor.`);
      result.flags[name] = true;
    } else if (strings.has(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (
        value === undefined ||
        value === '' ||
        (eq === -1 && value.startsWith('--'))
      ) {
        throw new UsageError(`--${name} necesita un valor.`);
      }
      result.flags[name] = value;
    } else {
      throw new UsageError(`Opción desconocida: --${name}`);
    }
  }
  return result;
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function flagInt(
  args: ParsedArgs,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = flagString(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(`--${name} espera un entero entre ${min} y ${max}.`);
  }
  return value;
}
