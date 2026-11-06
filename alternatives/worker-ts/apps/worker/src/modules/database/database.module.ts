import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient, type PrismaClient } from '@pokemon/db-main';
import type { Env } from '../../config/index.ts';

/** Lo que se espera a que Prisma cierre sus conexiones al apagarse. */
const DISCONNECT_TIMEOUT_MS = 2_000;

/** Token del PrismaClient compartido (base `pokemon`). */
export const PRISMA_CLIENT = 'PRISMA_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createPrismaClient(config.get('DATABASE_URL', { infer: true })),
    },
  ],
  exports: [PRISMA_CLIENT],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    // Un paso abandonado por el apagado puede seguir bloqueado en una sentencia de Postgres,
    // y $disconnect espera a que termine. Pasado el plazo se sigue: al salir el proceso se
    // cierra la conexión y Postgres deshace la transacción (el cerco ya impide que confirme).
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$disconnect(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, DISCONNECT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
