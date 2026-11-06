import { ApiError } from '../api/client.ts';

export type RequestStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

/** Error serializable (va al store): código HTTP si lo hubo, null si fue la red. */
export interface RequestError {
  status: number | null;
  message: string;
}

/** Estado de una petición y sus datos. */
export interface RequestState<T> {
  status: RequestStatus;
  data: T | null;
  error: RequestError | null;
}

export const idleRequest = <T>(): RequestState<T> => ({
  status: 'idle',
  data: null,
  error: null,
});

/**
 * Regla de caché de los thunks (su `condition`): no pedir lo que ya está o se
 * está pidiendo. Solo idle o failed vuelven a la API (failed = reintento).
 */
export const shouldFetch = (req: { status: RequestStatus } | undefined) =>
  req?.status !== 'loading' && req?.status !== 'succeeded';

export function toRequestError(error: unknown): RequestError {
  if (error instanceof ApiError) {
    return { status: error.status, message: error.message };
  }
  return {
    status: null,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Error de un thunk rechazado (rejectWithValue o, si no, el error serializado). */
export const rejectedError = (action: {
  payload?: RequestError | undefined;
  error: { message?: string | undefined };
}): RequestError =>
  action.payload ?? { status: null, message: action.error.message ?? 'Error' };
