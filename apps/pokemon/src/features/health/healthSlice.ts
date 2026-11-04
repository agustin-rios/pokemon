import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export type HealthStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface HealthState {
  status: HealthStatus;
}

const initialState: HealthState = { status: 'idle' };

export const fetchHealth = createAsyncThunk(
  'health/fetch',
  async (_: void, { signal }) => {
    const res = await fetch('/api/health', { signal });
    if (!res.ok) throw new Error(`GET /api/health → ${res.status}`);
    return (await res.json()) as { status: 'ok' };
  },
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
