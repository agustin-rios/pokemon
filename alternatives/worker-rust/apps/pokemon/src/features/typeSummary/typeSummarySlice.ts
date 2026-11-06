import { createSlice } from '@reduxjs/toolkit';
import type { TypeSummary } from '../../api/pokedexApi.ts';
import { createAppAsyncThunk } from '../../app/createAppAsyncThunk.ts';
import {
  idleRequest,
  rejectedError,
  shouldFetch,
  toRequestError,
} from '../request.ts';

export const fetchTypeSummary = createAppAsyncThunk(
  'typeSummary/fetch',
  async (_: void, { extra, signal, rejectWithValue }) => {
    try {
      return await extra.api.getTypeSummary(signal);
    } catch (error) {
      return rejectWithValue(toRequestError(error));
    }
  },
  // Se pide una vez por sesión.
  { condition: (_, { getState }) => shouldFetch(getState().typeSummary) },
);

export const typeSummarySlice = createSlice({
  name: 'typeSummary',
  initialState: idleRequest<TypeSummary[]>(),
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTypeSummary.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchTypeSummary.fulfilled, (state, { payload }) => {
        state.status = 'succeeded';
        state.data = payload;
      })
      .addCase(fetchTypeSummary.rejected, (state, action) => {
        state.status = 'failed';
        state.error = rejectedError(action);
      });
  },
  selectors: {
    selectTypeSummary: (state) => state,
  },
});

export const { selectTypeSummary } = typeSummarySlice.selectors;
