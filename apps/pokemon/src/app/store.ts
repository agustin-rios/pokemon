import { combineSlices, configureStore } from '@reduxjs/toolkit';
import type { PokedexApi } from '../api/pokedexApi.ts';
import { etlSlice } from '../features/etl/etlSlice.ts';
import { healthSlice } from '../features/health/healthSlice.ts';
import { pokemonSlice } from '../features/pokemon/pokemonSlice.ts';
import { reportsSlice } from '../features/reports/reportsSlice.ts';
import { typeSummarySlice } from '../features/typeSummary/typeSummarySlice.ts';

const rootReducer = combineSlices(
  healthSlice,
  pokemonSlice,
  typeSummarySlice,
  reportsSlice,
  etlSlice,
);

export type RootState = ReturnType<typeof rootReducer>;

/** Dependencias que reciben los thunks como `extra`: la API va inyectada. */
export interface ThunkExtra {
  api: PokedexApi;
}

// Una fábrica y no un singleton: cada test arma su store con su API falsa.
export function makeStore({
  api,
  preloadedState,
}: {
  api: PokedexApi;
  preloadedState?: Partial<RootState>;
}) {
  const extraArgument: ThunkExtra = { api };
  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ thunk: { extraArgument } }),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];
