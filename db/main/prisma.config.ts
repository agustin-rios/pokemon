import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: { path: './prisma/migrations' },
  // Opcional a propósito: `generate` (y con él el typecheck en CI) no la necesita;
  // `migrate` y `studio` fallan con un error claro si falta.
  datasource: { url: process.env['DATABASE_URL'] },
});
