import { parseArgs, UsageError } from './lib/args.ts';
import { error, info } from './lib/log.ts';
import { argSpecOf } from './commands/command.ts';
import { findCommand, helpText } from './commands/index.ts';

const HELP_ARGS = new Set(['help', '--help', '-h']);

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || HELP_ARGS.has(argv[0] ?? '')) {
    info(helpText());
    return 0;
  }
  const name = `${argv[0]} ${argv[1] ?? ''}`.trim();
  const command = findCommand(name);
  if (!command) {
    throw new UsageError(
      `Comando desconocido: "${name}". \`pnpm ops help\` lista los comandos.`,
    );
  }
  const args = parseArgs(argv.slice(2), argSpecOf(command));
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
