import { combineSlices, configureStore } from '@reduxjs/toolkit';
import { healthSlice } from '../features/health/healthSlice.ts';

const rootReducer = combineSlices(healthSlice);

export type RootState = ReturnType<typeof rootReducer>;

// Una fábrica y no un singleton: cada test arma su propio store.
export function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({ reducer: rootReducer, preloadedState });
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];
