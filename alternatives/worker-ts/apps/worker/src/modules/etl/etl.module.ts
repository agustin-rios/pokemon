import { Logger as NestLogger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import {
  BuildViews,
  ExecuteEtlRun,
  GenerateSyntheticData,
  LoadDataset,
  ScrapePokemon,
  ValidateDataset,
  type DatasetLoader,
  type Logger,
  type PokemonSource,
  type StagingStore,
  type ViewsBuilder,
} from '@pokemon/context-ingestion';
import {
  ETL_QUEUE,
  PgViewsBuilder,
  PokeApiPokemonSource,
  PrismaDatasetLoader,
  PrismaStagingStore,
} from '@pokemon/context-ingestion/adapters';
import type { PrismaClient } from '@pokemon/db-main';
import { provideUseCase } from '../../common/helpers/nest-provider.helper.ts';
import type { Env } from '../../config/index.ts';
import { PRISMA_CLIENT } from '../database/database.module.ts';
import { EtlProcessor } from './etl.processor.ts';

/** Tokens de los puertos del contexto ingestion. */
export const LOGGER = 'LOGGER';
export const POKEMON_SOURCE = 'POKEMON_SOURCE';
export const STAGING_STORE = 'STAGING_STORE';
export const DATASET_LOADER = 'DATASET_LOADER';
export const VIEWS_BUILDER = 'VIEWS_BUILDER';

/** Plazo de cada paso: vencido, se cancela y la corrida se reintenta. */
const STEP_DEADLINE_MS = 5 * 60_000;
/** Lo que se le deja al paso en curso para terminar cuando llega SIGTERM/SIGINT. */
const SHUTDOWN_GRACE_MS = 10_000;

@Module({
  imports: [
    // Mismo REDIS_URL que la API: la cola `etl` es el medio por el que se hablan.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
      }),
    }),
    BullModule.registerQueue({ name: ETL_QUEUE }),
  ],
  providers: [
    {
      provide: LOGGER,
      useFactory: (): Logger => {
        const logger = new NestLogger('Etl');
        return {
          info: (message) => logger.log(message),
          warn: (message) => logger.warn(message),
          error: (message) => logger.error(message),
        };
      },
    },
    {
      provide: POKEMON_SOURCE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PokemonSource =>
        new PokeApiPokemonSource(config.get('POKEAPI_URL', { infer: true })),
    },
    {
      provide: STAGING_STORE,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient): StagingStore =>
        new PrismaStagingStore(prisma),
    },
    {
      provide: DATASET_LOADER,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient): DatasetLoader =>
        new PrismaDatasetLoader(prisma),
    },
    {
      provide: VIEWS_BUILDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ViewsBuilder =>
        new PgViewsBuilder(config.get('DATABASE_URL', { infer: true })),
    },
    {
      provide: ScrapePokemon,
      inject: [POKEMON_SOURCE, STAGING_STORE, ConfigService],
      useFactory: (
        source: PokemonSource,
        staging: StagingStore,
        config: ConfigService<Env, true>,
      ) =>
        new ScrapePokemon(
          source,
          staging,
          config.get('POKEMON_LIMIT', { infer: true }),
        ),
    },
    provideUseCase(GenerateSyntheticData, [STAGING_STORE]),
    provideUseCase(ValidateDataset, [STAGING_STORE, LOGGER]),
    provideUseCase(LoadDataset, [STAGING_STORE, DATASET_LOADER]),
    provideUseCase(BuildViews, [VIEWS_BUILDER]),
    {
      provide: ExecuteEtlRun,
      inject: [
        ScrapePokemon,
        GenerateSyntheticData,
        ValidateDataset,
        LoadDataset,
        BuildViews,
        LOGGER,
      ],
      useFactory: (
        scrape: ScrapePokemon,
        generate: GenerateSyntheticData,
        validate: ValidateDataset,
        load: LoadDataset,
        build_views: BuildViews,
        logger: Logger,
      ) =>
        new ExecuteEtlRun(
          { scrape, generate, validate, load, build_views },
          logger,
          {
            stepDeadlineMs: STEP_DEADLINE_MS,
            shutdownGraceMs: SHUTDOWN_GRACE_MS,
          },
        ),
    },
    EtlProcessor,
  ],
})
export class EtlModule {}
