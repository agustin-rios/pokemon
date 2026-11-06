import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RequestError } from '../features/request.ts';
import type { AppDispatch, RootState, ThunkExtra } from './store.ts';

/** createAsyncThunk con los tipos de la app: estado, dispatch, API inyectada y error. */
export const createAppAsyncThunk = createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
  extra: ThunkExtra;
  rejectValue: RequestError;
}>();
