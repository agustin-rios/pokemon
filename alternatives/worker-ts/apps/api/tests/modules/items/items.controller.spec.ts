import type { INestApplication } from '@nestjs/common';
import {
  GetPokemon,
  GetTypeSummary,
  ListPokemon,
  ValidationError,
  type Pokemon,
} from '@pokemon/context-pokedex';
import { ItemsController } from '../../../src/modules/items/items.controller.ts';
import { missingViewError, startApp } from '../../helpers.ts';

const charizard: Pokemon = {
  id: 6,
  name: 'charizard',
  height: 17,
  weight: 905,
  baseExperience: 267,
  sprite: 'https://img/6.png',
  types: [
    { id: 10, name: 'fire', slot: 1 },
    { id: 3, name: 'flying', slot: 2 },
  ],
};

describe('ItemsController', () => {
  const listPokemon = { execute: vi.fn() };
  const getPokemon = { execute: vi.fn() };
  const getTypeSummary = { execute: vi.fn() };
  let app: INestApplication;
  let url: (path: string) => string;

  beforeAll(async () => {
    ({ app, url } = await startApp(ItemsController, [
      { provide: ListPokemon, useValue: listPokemon },
      { provide: GetPokemon, useValue: getPokemon },
      { provide: GetTypeSummary, useValue: getTypeSummary },
    ]));
  });

  afterAll(() => app.close());
  beforeEach(() => vi.resetAllMocks());

  it('GET /items usa la página por defecto', async () => {
    const page = { items: [charizard], total: 100, page: 1, pageSize: 20 };
    listPokemon.execute.mockResolvedValue(page);

    const res = await fetch(url('/items'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(page);
    expect(listPokemon.execute).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('GET /items convierte page y pageSize a número', async () => {
    listPokemon.execute.mockResolvedValue({
      items: [],
      total: 100,
      page: 2,
      pageSize: 5,
    });

    await fetch(url('/items?page=2&pageSize=5'));

    expect(listPokemon.execute).toHaveBeenCalledWith({ page: 2, pageSize: 5 });
  });

  it.each(['page=0', 'pageSize=101', 'pageSize=x'])(
    'GET /items?%s → 400 sin llamar al caso de uso',
    async (query) => {
      const res = await fetch(url(`/items?${query}`));

      expect(res.status).toBe(400);
      expect(listPokemon.execute).not.toHaveBeenCalled();
    },
  );

  it('GET /items/summary no cae en la ruta :id', async () => {
    const summary = [
      {
        typeId: 10,
        typeName: 'fire',
        pokemonCount: 12,
        averageBaseExperience: 145.08,
      },
    ];
    getTypeSummary.execute.mockResolvedValue(summary);

    const res = await fetch(url('/items/summary'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(summary);
    expect(getPokemon.execute).not.toHaveBeenCalled();
  });

  it('GET /items/:id devuelve el Pokémon con sus tipos', async () => {
    getPokemon.execute.mockResolvedValue(charizard);

    const res = await fetch(url('/items/6'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(charizard);
    expect(getPokemon.execute).toHaveBeenCalledWith(6);
  });

  it('GET /items/:id inexistente → 404', async () => {
    getPokemon.execute.mockResolvedValue(null);

    const res = await fetch(url('/items/999'));

    expect(res.status).toBe(404);
  });

  it.each(['abc', '0', '-1', '1.5'])(
    'GET /items/%s → 400 sin llamar al caso de uso',
    async (id) => {
      const res = await fetch(url(`/items/${id}`));

      expect(res.status).toBe(400);
      expect(getPokemon.execute).not.toHaveBeenCalled();
    },
  );

  it('un ValidationError del contexto → 400', async () => {
    listPokemon.execute.mockRejectedValue(new ValidationError('page inválida'));

    const res = await fetch(url('/items'));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe(
      'page inválida',
    );
  });

  it('GET /items/summary sin la vista en la base → 503', async () => {
    getTypeSummary.execute.mockRejectedValue(missingViewError());

    const res = await fetch(url('/items/summary'));

    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toMatch(
      /no están cargados/,
    );
  });
});
