import { Module } from '@nestjs/common';
import {
  GetPokemon,
  GetTypeSummary,
  ListPokemon,
} from '@pokemon/context-pokedex';
import { provideUseCase } from '../../common/helpers/nest-provider.helper.ts';
import {
  POKEMON_REPOSITORY,
  PokedexRepositoriesModule,
  REPORTS_REPOSITORY,
} from '../pokedex/pokedex-repositories.module.ts';
import { ItemsController } from './items.controller.ts';

@Module({
  imports: [PokedexRepositoriesModule],
  providers: [
    provideUseCase(ListPokemon, [POKEMON_REPOSITORY]),
    provideUseCase(GetPokemon, [POKEMON_REPOSITORY]),
    provideUseCase(GetTypeSummary, [REPORTS_REPOSITORY]),
  ],
  controllers: [ItemsController],
})
export class ItemsModule {}
