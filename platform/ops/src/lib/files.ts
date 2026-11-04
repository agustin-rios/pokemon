import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Escribe varios archivos sin dejar nunca uno a medias: primero todos como
 * temporales ocultos en la misma carpeta y, solo si se escribieron todos, los
 * renombra a su nombre final (rename es atómico dentro de un mismo disco).
 * Si algo falla, los archivos anteriores quedan intactos y se borran los temporales.
 */
export async function writeFilesAtomically(
  dir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tag = `${process.pid}-${randomUUID().slice(0, 8)}`;
  const entries = Object.entries(files).map(([name, content]) => ({
    final: join(dir, name),
    temp: join(dir, `.${name}.${tag}.tmp`),
    content,
  }));
  try {
    for (const { temp, content } of entries) await writeFile(temp, content);
    for (const { temp, final } of entries) await rename(temp, final);
  } catch (err) {
    await Promise.all(entries.map(({ temp }) => rm(temp, { force: true })));
    throw err;
  }
}
