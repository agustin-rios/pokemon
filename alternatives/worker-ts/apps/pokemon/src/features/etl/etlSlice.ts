import { createSlice } from '@reduxjs/toolkit';
import type { EtlRun } from '../../api/pokedexApi.ts';
import { createAppAsyncThunk } from '../../app/createAppAsyncThunk.ts';
import { idleRequest, rejectedError, toRequestError } from '../request.ts';

/** Dispara la carga de datos (POST /etl/runs). No se cachea: cada clic es una corrida. */
export const triggerEtl = createAppAsyncThunk(
  'etl/trigger',
  async (_: void, { extra, signal, rejectWithValue }) => {
    try {
      return await extra.api.triggerEtl(signal);
    } catch (error) {
      return rejectWithValue(toRequestError(error));
    }
  },
  // Evita disparar dos corridas con un doble clic.
  { condition: (_, { getState }) => getState().etl.status !== 'loading' },
);

export const etlSlice = createSlice({
  name: 'etl',
  initialState: idleRequest<EtlRun>(),
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(triggerEtl.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(triggerEtl.fulfilled, (state, { payload }) => {
        state.status = 'succeeded';
        state.data = payload;
      })
      .addCase(triggerEtl.rejected, (state, action) => {
        state.status = 'failed';
        state.error = rejectedError(action);
      });
  },
  selectors: {
    selectEtl: (state) => state,
  },
});

export const { selectEtl } = etlSlice.selectors;
