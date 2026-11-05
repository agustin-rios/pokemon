import { selectIsFetchingPokemon } from '../features/pokemon/pokemonSlice.ts';
import { selectIsFetchingReports } from '../features/reports/reportsSlice.ts';
import type { RootState } from './store.ts';

/** Hay alguna petición de datos en curso: alimenta la barra de carga global. */
export const selectIsFetching = (state: RootState) =>
  selectIsFetchingPokemon(state) ||
  selectIsFetchingReports(state) ||
  state.typeSummary.status === 'loading' ||
  state.etl.status === 'loading';
