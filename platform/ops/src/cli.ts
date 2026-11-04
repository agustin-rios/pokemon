import {
  parseArgs,
  UsageError,
  type ArgSpec,
  type ParsedArgs,
} from './lib/args.ts';
import { bold, error, info } from './lib/log.ts';

const HELP = `${bold('pnpm ops')} — operaciones del proyecto

Todavía no hay comandos. Cada uno va en src/commands/ y se registra en COMMANDS (src/cli.ts).`;

interface Command {
  spec: ArgSpec;
  run: (args: ParsedArgs) => Promise<number | void>;
}

/** "grupo acción" → comando; p. ej. 'data scrape': { spec, run }. */
const COMMANDS: Record<string, Command> = {};

async function main(argv: string[]): Promise<number> {
  if (
    argv.length === 0 ||
    argv[0] === 'help' ||
    argv[0] === '--help' ||
    argv[0] === '-h'
  ) {
    info(HELP);
    return 0;
  }
  const name = `${argv[0]} ${argv[1] ?? ''}`.trim();
  const command = COMMANDS[name];
  if (!command) {
    throw new UsageError(
      `Comando desconocido: "${name}". \`pnpm ops help\` lista los comandos.`,
    );
  }
  const args = parseArgs(argv.slice(2), command.spec);
  if (args.positionals.length > 0) {
    throw new UsageError(
      `\`${name}\` no recibe argumentos sueltos: ${args.positionals.join(' ')}`,
    );
  }
  return (await command.run(args)) ?? 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    error(err instanceof Error ? err.message : String(err));
    if (process.env['OPS_DEBUG'] && err instanceof Error) {
      console.error(err.stack);
    }
    process.exit(err instanceof UsageError ? 2 : 1);
  },
);
