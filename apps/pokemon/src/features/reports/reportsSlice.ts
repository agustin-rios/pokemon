import { createSlice } from '@reduxjs/toolkit';
import type {
  LevelClassification,
  MonthlyCaptureGrowth,
  TopTrainer,
} from '../../api/pokedexApi.ts';
import { createAppAsyncThunk } from '../../app/createAppAsyncThunk.ts';
import {
  idleRequest,
  rejectedError,
  shouldFetch,
  toRequestError,
  type RequestState,
} from '../request.ts';

export interface ReportsState {
  monthlyGrowth: RequestState<MonthlyCaptureGrowth[]>;
  topTrainers: RequestState<TopTrainer[]>;
  levelClassification: RequestState<LevelClassification[]>;
}

const initialState: ReportsState = {
  monthlyGrowth: idleRequest(),
  topTrainers: idleRequest(),
  levelClassification: idleRequest(),
};

// Cada reporte se pide una vez por sesión (condition) y guarda su propio estado.

export const fetchMonthlyGrowth = createAppAsyncThunk(
  'reports/fetchMonthlyGrowth',
  async (_: void, { extra, signal, rejectWithValue }) => {
    try {
      return await extra.api.getMonthlyGrowth(signal);
    } catch (error) {
      return rejectWithValue(toRequestError(error));
    }
  },
  {
    condition: (_, { getState }) =>
      shouldFetch(getState().reports.monthlyGrowth),
  },
);

export const fetchTopTrainers = createAppAsyncThunk(
  'reports/fetchTopTrainers',
  async (_: void, { extra, signal, rejectWithValue }) => {
    try {
      return await extra.api.getTopTrainers(signal);
    } catch (error) {
      return rejectWithValue(toRequestError(error));
    }
  },
  {
    condition: (_, { getState }) => shouldFetch(getState().reports.topTrainers),
  },
);

export const fetchLevelClassification = createAppAsyncThunk(
  'reports/fetchLevelClassification',
  async (_: void, { extra, signal, rejectWithValue }) => {
    try {
      return await extra.api.getLevelClassification(signal);
    } catch (error) {
      return rejectWithValue(toRequestError(error));
    }
  },
  {
    condition: (_, { getState }) =>
      shouldFetch(getState().reports.levelClassification),
  },
);

export const reportsSlice = createSlice({
  name: 'reports',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchMonthlyGrowth.pending, (state) => {
        state.monthlyGrowth.status = 'loading';
        state.monthlyGrowth.error = null;
      })
      .addCase(fetchMonthlyGrowth.fulfilled, (state, { payload }) => {
        state.monthlyGrowth.status = 'succeeded';
        state.monthlyGrowth.data = payload;
      })
      .addCase(fetchMonthlyGrowth.rejected, (state, action) => {
        state.monthlyGrowth.status = 'failed';
        state.monthlyGrowth.error = rejectedError(action);
      })
      .addCase(fetchTopTrainers.pending, (state) => {
        state.topTrainers.status = 'loading';
        state.topTrainers.error = null;
      })
      .addCase(fetchTopTrainers.fulfilled, (state, { payload }) => {
        state.topTrainers.status = 'succeeded';
        state.topTrainers.data = payload;
      })
      .addCase(fetchTopTrainers.rejected, (state, action) => {
        state.topTrainers.status = 'failed';
        state.topTrainers.error = rejectedError(action);
      })
      .addCase(fetchLevelClassification.pending, (state) => {
        state.levelClassification.status = 'loading';
        state.levelClassification.error = null;
      })
      .addCase(fetchLevelClassification.fulfilled, (state, { payload }) => {
        state.levelClassification.status = 'succeeded';
        state.levelClassification.data = payload;
      })
      .addCase(fetchLevelClassification.rejected, (state, action) => {
        state.levelClassification.status = 'failed';
        state.levelClassification.error = rejectedError(action);
      });
  },
  selectors: {
    selectMonthlyGrowth: (state) => state.monthlyGrowth,
    selectTopTrainers: (state) => state.topTrainers,
    selectLevelClassification: (state) => state.levelClassification,
    selectIsFetchingReports: (state) =>
      Object.values(state).some((report) => report.status === 'loading'),
  },
});

export const {
  selectMonthlyGrowth,
  selectTopTrainers,
  selectLevelClassification,
  selectIsFetchingReports,
} = reportsSlice.selectors;
