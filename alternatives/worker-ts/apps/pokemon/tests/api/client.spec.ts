import { ApiError, request } from '../../src/api/client.ts';
import { httpPokedexApi } from '../../src/api/pokedexApi.ts';

describe('cliente HTTP', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pide bajo /api y devuelve el JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('/x')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/x',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('un error HTTP lanza ApiError con el status y el mensaje de Nest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            statusCode: 400,
            message: ['page: Too small', 'pageSize: Too big'],
          },
          { status: 400 },
        ),
      ),
    );

    const error = await request('/items').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      message: 'page: Too small, pageSize: Too big',
    });
  });

  it('arma las URL de cada endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMock);

    await httpPokedexApi.listPokemon({ page: 2, pageSize: 12 });
    await httpPokedexApi.getPokemon(6);
    await httpPokedexApi.getTypeSummary();
    await httpPokedexApi.getMonthlyGrowth();
    await httpPokedexApi.getTopTrainers();
    await httpPokedexApi.getLevelClassification();
    await httpPokedexApi.triggerEtl();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/items?page=2&pageSize=12',
      '/api/items/6',
      '/api/items/summary',
      '/api/reports/monthly-growth',
      '/api/reports/top-trainers',
      '/api/reports/level-classification',
      '/api/etl/runs',
    ]);
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'POST' });
  });
});
