import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del monorepo (este archivo vive en platform/ops/src/lib). */
export const REPO_ROOT = fileURLToPath(
  new URL('../../../../', import.meta.url),
);

/** Carpeta de los CSV de entrada que lee Airflow. */
export const DATA_DIR = resolve(REPO_ROOT, 'data');

/** Ruta relativa a la raíz para mensajes; absoluta si queda fuera del repo. */
export function fromRoot(path: string): string {
  const rel = relative(REPO_ROOT, path);
  if (rel === '') return '.';
  return rel.startsWith('..') ? path : rel;
}
