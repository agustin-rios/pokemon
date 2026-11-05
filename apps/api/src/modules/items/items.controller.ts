import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  GetPokemon,
  GetTypeSummary,
  ListPokemon,
  MAX_PAGE_SIZE,
  type Page,
  type Pokemon,
  type TypeSummary,
} from '@pokemon/context-pokedex';
import { z } from 'zod';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

const pokemonId = z.coerce.number().int().positive();

@Controller('items')
export class ItemsController {
  constructor(
    @Inject(ListPokemon) private readonly listPokemon: ListPokemon,
    @Inject(GetPokemon) private readonly getPokemon: GetPokemon,
    @Inject(GetTypeSummary) private readonly getTypeSummary: GetTypeSummary,
  ) {}

  /** Lista paginada de Pokémon con sus tipos. */
  @Get()
  list(
    @Query({ schema: listQuery }) query: z.output<typeof listQuery>,
  ): Promise<Page<Pokemon>> {
    return this.listPokemon.execute(query);
  }

  /** Pokémon y experiencia base promedio por tipo (agregado en la base). Antes de :id. */
  @Get('summary')
  summary(): Promise<TypeSummary[]> {
    return this.getTypeSummary.execute();
  }

  /** Un Pokémon con sus tipos: 400 si el id no es un entero positivo, 404 si no existe. */
  @Get(':id')
  async findOne(
    @Param('id', { schema: pokemonId }) id: number,
  ): Promise<Pokemon> {
    const pokemon = await this.getPokemon.execute(id);
    if (!pokemon) throw new NotFoundException(`No existe el Pokémon ${id}`);
    return pokemon;
  }
}
