import type { ArgSpec, ParsedArgs } from '../lib/args.ts';

export interface CommandOption {
  /** Sin guiones: "limit" → --limit. */
  name: string;
  /** Placeholder del valor ("<n>"). Sin él, la opción es un booleano. */
  value?: string;
  description: string;
}

/** Un comando de `pnpm ops`: cómo se llama, sus instrucciones y qué ejecuta. */
export interface Command {
  /** "grupo acción", p. ej. "data scrape". El grupo ordena la ayuda. */
  name: string;
  /** Una línea para la ayuda. */
  summary: string;
  options?: readonly CommandOption[];
  run: (args: ParsedArgs) => Promise<number | void>;
}

/** Las opciones declaradas definen también qué flags acepta el comando. */
export function argSpecOf(command: Command): ArgSpec {
  const options = command.options ?? [];
  return {
    strings: options.filter((o) => o.value).map((o) => o.name),
    booleans: options.filter((o) => !o.value).map((o) => o.name),
  };
}
