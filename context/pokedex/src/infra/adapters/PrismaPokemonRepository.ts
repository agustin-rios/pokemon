import { Prisma } from '@pokemon/db-main';
import type { PrismaClient } from '@pokemon/db-main';

import type { Pokemon } from '../../domain/entities/Pokemon.ts';
import type {
  Page,
  PageQuery,
  PokemonRepository,
} from '../../application/ports/PokemonRepository.ts';

const pokemonInclude = {
  types: {
    include: { type: true },
    orderBy: { slot: 'asc' },
  },
} satisfies Prisma.PokemonInclude;

type PokemonRow = Prisma.PokemonGetPayload<{
  include: typeof pokemonInclude;
}>;

const toDomain = (row: PokemonRow): Pokemon => ({
  id: row.id,
  name: row.name,
  height: row.height,
  weight: row.weight,
  baseExperience: row.baseExperience,
  sprite: row.spriteUrl,
  types: row.types.map(({ slot, type }) => ({
    id: type.id,
    name: type.name,
    slot,
  })),
});

export class PrismaPokemonRepository implements PokemonRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async list({ page, pageSize }: PageQuery): Promise<Page<Pokemon>> {
    const [rows, total] = await Promise.all([
      this.prisma.pokemon.findMany({
        orderBy: { id: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: pokemonInclude,
      }),
      this.prisma.pokemon.count(),
    ]);

    return {
      items: rows.map(toDomain),
      total,
      page,
      pageSize,
    };
  }

  async findById(id: number): Promise<Pokemon | null> {
    const row = await this.prisma.pokemon.findUnique({
      where: { id },
      include: pokemonInclude,
    });

    return row ? toDomain(row) : null;
  }
}
