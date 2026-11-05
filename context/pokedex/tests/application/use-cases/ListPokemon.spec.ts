import { ValidationError } from '../../../src/application/errors.ts';
import {
  DEFAULT_PAGE_SIZE,
  ListPokemon,
  MAX_PAGE_SIZE,
} from '../../../src/application/use-cases/ListPokemon.ts';
import { stubPokemonRepository } from '../../stubs.ts';

describe('ListPokemon', () => {
  it('sin parámetros pide la primera página con el tamaño por defecto', async () => {
    const repo = stubPokemonRepository();
    const page = { items: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE };
    repo.list.mockResolvedValue(page);

    await expect(new ListPokemon(repo).execute()).resolves.toBe(page);
    expect(repo.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('pasa page y pageSize al repositorio', async () => {
    const repo = stubPokemonRepository();
    await new ListPokemon(repo).execute({ page: 3, pageSize: 50 });
    expect(repo.list).toHaveBeenCalledWith({ page: 3, pageSize: 50 });
  });

  it.each([
    [{ page: 0 }],
    [{ page: 1.5 }],
    [{ pageSize: 0 }],
    [{ pageSize: MAX_PAGE_SIZE + 1 }],
  ])('rechaza %o sin consultar el repositorio', (input) => {
    const repo = stubPokemonRepository();
    expect(() => new ListPokemon(repo).execute(input)).toThrow(ValidationError);
    expect(repo.list).not.toHaveBeenCalled();
  });
});
