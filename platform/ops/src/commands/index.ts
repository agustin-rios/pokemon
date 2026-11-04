import { bold } from '../lib/log.ts';
import type { Command } from './command.ts';
import { dataGenerate, dataPrepare, dataScrape } from './data.ts';

/**
 * Todos los comandos de `pnpm ops`. Para agregar uno: créalo en su archivo de
 * grupo (src/commands/<grupo>.ts) y súmalo aquí; la ayuda sale de esta lista.
 */
export const COMMANDS: readonly Command[] = [
  dataScrape,
  dataGenerate,
  dataPrepare,
];

/** Título de cada grupo en la ayuda (el grupo es la primera palabra del nombre). */
const GROUP_TITLES: Record<string, string> = {
  data: `${bold('Datos')} (CSV en data/, la carpeta que lee Airflow)`,
};

const groupOf = (command: Command) => command.name.split(' ')[0] ?? '';

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((command) => command.name === name);
}

export function helpText(): string {
  const lines = [`${bold('pnpm ops')} — operaciones del proyecto`];
  for (const group of new Set(COMMANDS.map(groupOf))) {
    lines.push('', GROUP_TITLES[group] ?? bold(group));
    for (const command of COMMANDS.filter((c) => groupOf(c) === group)) {
      lines.push(`  ${command.name.padEnd(26)}  ${command.summary}`);
      for (const option of command.options ?? []) {
        const flag = `--${option.name}${option.value ? ` ${option.value}` : ''}`;
        lines.push(`      ${flag.padEnd(22)}  ${option.description}`);
      }
    }
  }
  return lines.join('\n');
}
