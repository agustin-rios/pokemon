import { ApiError } from '../../src/api/client.ts';
import { makeStore } from '../../src/app/store.ts';
import {
  fetchPokemon,
  fetchPokemonPage,
  selectPageCount,
  selectPokemonPage,
  selectPokemonRequest,
} from '../../src/features/pokemon/pokemonSlice.ts';
import {
  fetchLevelClassification,
  fetchMonthlyGrowth,
  fetchTopTrainers,
} from '../../src/features/reports/reportsSlice.ts';
import { fetchTypeSummary } from '../../src/features/typeSummary/typeSummarySlice.ts';
import { fakeApi } from '../support/fakeApi.ts';

// Lo pedido queda en el store: volver a pedirlo no vuelve a la API.
describe('caché en el store', () => {
  it('una página ya pedida no se vuelve a pedir, aunque se pida dos veces a la vez', async () => {
    const api = fakeApi();
    const store = makeStore({ api });

    await Promise.all([
      store.dispatch(fetchPokemonPage(1)),
      store.dispatch(fetchPokemonPage(1)),
    ]);
    await store.dispatch(fetchPokemonPage(1));

    expect(api.listPokemon).toHaveBeenCalledTimes(1);
    const page = selectPokemonPage(store.getState(), 1);
    expect(page.status).toBe('succeeded');
    expect(page.pokemon.map((p) => p.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(selectPageCount(store.getState())).toBe(3);
  });

  it('el detalle de un Pokémon que vino en la lista sale del store', async () => {
    const api = fakeApi();
    const store = makeStore({ api });

    await store.dispatch(fetchPokemonPage(1));
    await store.dispatch(fetchPokemon(5));

    expect(api.getPokemon).not.toHaveBeenCalled();
    expect(selectPokemonRequest(store.getState(), 5).status).toBe('succeeded');
  });

  it('un detalle fallido guarda el status HTTP y se puede reintentar', async () => {
    const api = fakeApi();
    const store = makeStore({ api });

    await store.dispatch(fetchPokemon(999));
    expect(selectPokemonRequest(store.getState(), 999)).toMatchObject({
      status: 'failed',
      error: { status: 404 },
    });

    api.getPokemon.mockRejectedValueOnce(new ApiError(503, 'sin datos'));
    await store.dispatch(fetchPokemon(999));
    expect(api.getPokemon).toHaveBeenCalledTimes(2);
  });

  it('el resumen y los reportes se piden una sola vez', async () => {
    const api = fakeApi();
    const store = makeStore({ api });

    for (let i = 0; i < 2; i++) {
      await store.dispatch(fetchTypeSummary());
      await store.dispatch(fetchMonthlyGrowth());
      await store.dispatch(fetchTopTrainers());
      await store.dispatch(fetchLevelClassification());
    }

    expect(api.getTypeSummary).toHaveBeenCalledTimes(1);
    expect(api.getMonthlyGrowth).toHaveBeenCalledTimes(1);
    expect(api.getTopTrainers).toHaveBeenCalledTimes(1);
    expect(api.getLevelClassification).toHaveBeenCalledTimes(1);
  });
});
