import type { INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { setupApp } from '../src/app.setup.ts';

/** App de Nest con un controller y sus dependencias stub, configurada como en main.ts. */
export async function startApp(
  controller: Type,
  providers: Provider[],
): Promise<{ app: INestApplication; url: (path: string) => string }> {
  const moduleRef = await Test.createTestingModule({
    controllers: [controller],
    providers,
  }).compile();
  const app = setupApp(moduleRef.createNestApplication({ logger: false }));
  await app.listen(0);
  const base = await app.getUrl();
  return { app, url: (path) => `${base}/api${path}` };
}

/** Error con la forma que lanza Prisma cuando una vista no existe (SQLSTATE 42P01). */
export const missingViewError = () =>
  Object.assign(new Error('Raw query failed'), {
    code: 'P2010',
    meta: {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: { originalCode: '42P01', kind: 'TableDoesNotExist' },
      },
    },
  });
