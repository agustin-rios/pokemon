import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandError, execInteractive } from '../../src/lib/exec.ts';

test('resuelve cuando el comando termina en 0', async () => {
  await execInteractive(process.execPath, ['-e', 'process.exit(0)']);
});

test('rechaza con CommandError y el código de salida', async () => {
  await assert.rejects(
    execInteractive(process.execPath, ['-e', 'process.exit(3)'], {
      label: 'demo',
    }),
    (err: unknown) =>
      err instanceof CommandError &&
      err.code === 3 &&
      err.message === 'demo salió con código 3',
  );
});

test('explica cuando el comando no existe', async () => {
  await assert.rejects(
    execInteractive('no-existe-este-comando-ops', []),
    /No se encontró `no-existe-este-comando-ops` en el PATH/,
  );
});
