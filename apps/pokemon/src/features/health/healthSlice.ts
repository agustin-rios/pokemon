import { createSlice } from '@reduxjs/toolkit';
import { createAppAsyncThunk } from '../../app/createAppAsyncThunk.ts';

export type HealthStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface HealthState {
  status: HealthStatus;
}

const initialState: HealthState = { status: 'idle' };

export const fetchHealth = createAppAsyncThunk(
  'health/fetch',
  (_: void, { extra, signal }) => extra.api.health(signal),
);

export const healthSlice = createSlice({
  name: 'health',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchHealth.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(fetchHealth.fulfilled, (state) => {
        state.status = 'ok';
      })
      .addCase(fetchHealth.rejected, (state, action) => {
        // Cancelada por el cleanup del useEffect: no es un error de la API.
        if (!action.meta.aborted) state.status = 'error';
      });
  },
  selectors: {
    selectHealthStatus: (state) => state.status,
  },
});

export const { selectHealthStatus } = healthSlice.selectors;
