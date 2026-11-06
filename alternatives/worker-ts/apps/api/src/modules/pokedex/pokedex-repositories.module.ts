import { Module } from '@nestjs/common';
import {
  PrismaPokemonRepository,
  PrismaReportsRepository,
} from '@pokemon/context-pokedex/adapters';
import type { PrismaClient } from '@pokemon/db-main';
import { PRISMA_CLIENT } from '../database/database.module.ts';

/** Tokens de los puertos del contexto pokedex. */
export const POKEMON_REPOSITORY = 'POKEMON_REPOSITORY';
export const REPORTS_REPOSITORY = 'REPORTS_REPOSITORY';

/**
 * Elige los adapters de los repositorios del contexto.
 */
@Module({
  providers: [
    {
      provide: POKEMON_REPOSITORY,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaPokemonRepository(prisma),
    },
    {
      provide: REPORTS_REPOSITORY,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaReportsRepository(prisma),
    },
  ],
  exports: [POKEMON_REPOSITORY, REPORTS_REPOSITORY],
})
export class PokedexRepositoriesModule {}
