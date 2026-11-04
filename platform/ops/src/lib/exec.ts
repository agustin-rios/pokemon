import { spawn } from 'node:child_process';

export class CommandError extends Error {
  readonly code: number;
  constructor(label: string, code: number) {
    super(`${label} salió con código ${code}`);
    this.name = 'CommandError';
    this.code = code;
  }
}

/** Ejecuta un comando con su salida en la terminal; rechaza si no termina en 0. */
export function execInteractive(
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; label?: string } = {},
): Promise<void> {
  const label = opts.label ?? cmd;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: 'inherit' });
    child.on('error', (err: NodeJS.ErrnoException) =>
      reject(
        err.code === 'ENOENT'
          ? new Error(`No se encontró \`${cmd}\` en el PATH.`)
          : err,
      ),
    );
    child.on('close', (code, signal) => {
      const status = code ?? (signal ? 128 : 1);
      if (status === 0) resolve();
      else reject(new CommandError(label, status));
    });
  });
}
