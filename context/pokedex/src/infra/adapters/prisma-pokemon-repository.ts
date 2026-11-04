import type { PrismaClient } from '@pokemon/db-main';
import type { Pokemon } from '../../domain/index.ts';
import type { PokemonRepository } from '../../application/index.ts';

export class PrismaPokemonRepository implements PokemonRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Tipo de retorno explícito: el adapter entrega dominio, no tipos de Prisma.
  findById(id: number): Promise<Pokemon | null> {
    return this.prisma.pokemon.findUnique({ where: { id } });
  }
}
