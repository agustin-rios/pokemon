import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeFilesAtomically } from '../../src/lib/files.ts';

const tempDir = () => mkdtemp(join(tmpdir(), 'ops-files-'));

test('escribe todos los archivos y no deja temporales', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'a.csv'), 'viejo');

  await writeFilesAtomically(dir, { 'a.csv': 'nuevo', 'b.csv': 'b' });

  assert.equal(await readFile(join(dir, 'a.csv'), 'utf8'), 'nuevo');
  assert.equal(await readFile(join(dir, 'b.csv'), 'utf8'), 'b');
  assert.deepEqual((await readdir(dir)).sort(), ['a.csv', 'b.csv']);
});

test('si un archivo falla, los anteriores quedan intactos y sin temporales', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'a.csv'), 'viejo');

  // "sub/" no existe: falla el segundo archivo después de escribir el primero.
  await assert.rejects(
    writeFilesAtomically(dir, { 'a.csv': 'nuevo', 'sub/b.csv': 'b' }),
  );

  assert.equal(await readFile(join(dir, 'a.csv'), 'utf8'), 'viejo');
  assert.deepEqual(await readdir(dir), ['a.csv']);
});
