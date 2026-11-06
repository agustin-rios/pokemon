import {
  createEntityAdapter,
  createSelector,
  createSlice,
} from '@reduxjs/toolkit';
import type { Pokemon } from '../../api/pokedexApi.ts';
import { createAppAsyncThunk } from '../../app/createAppAsyncThunk.ts';
import type { RootState } from '../../app/store.ts';
import {
  rejectedError,
  shouldFetch,
  toRequestError,
  type RequestError,
  type RequestStatus,
} from '../request.ts';

/** Tarjetas por página: divisible por 2, 3 y 4 columnas. */
export const PAGE_SIZE = 12;

export interface PageEntry {
  status: RequestStatus;
  ids: number[];
  error: RequestError | null;
}

export interface DetailEntry {
  status: RequestStatus;
  error: RequestError | null;
}

const pokemonAdapter = createEntityAdapter<Pokemon>({
  sortComparer: (a, b) => a.id - b.id,
});

/**
 * Caché de Pokémon: cada Pokémon una sola vez (entity adapter), las páginas
 * pedidas por número y el estado de los detalles pedidos sueltos.
 */
const initialState = pokemonAdapter.getInitialState({
  pages: {} as Record<number, PageEntry>,
  details: {} as Record<number, DetailEntry>,
  /** Total de Pokémon según la última página recibida; null hasta la primera. */
  total: null as number | null,
});

export const fetchPokemonPage = createAppAsyncThunk(
  'pokemon/fetchPage',
  async (page: number, { extra, signal, rejectWithValue }) => {
    try {
      return await extra.api.listPokemon({ page, pageSize: PAGE_SIZE }, signal);
    } catch (error) {
      return rejectWithValue(toRequestError(error));
    }
  },
  {
    // Ya pedida o en curso: no se vuelve a la API.
    condition: (page, { getState }) =>
      shouldFetch(getState().pokemon.pages[page]),
  },
);

export const fetchPokemon = createAppAsyncThunk(
  'pokemon/fetchOne',
  async (id: number, { extra, signal, rejectWithValue }) => {
    try {
      return await extra.api.getPokemon(id, signal);
    } catch (error) {
      return rejectWithValue(toRequestError(error));
    }
  },
  {
    // Si vino en alguna página de la lista ya está en caché.
    condition: (id, { getState }) => {
      const state = getState().pokemon;
      return !state.entities[id] && shouldFetch(state.details[id]);
    },
  },
);

export const pokemonSlice = createSlice({
  name: 'pokemon',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPokemonPage.pending, (state, { meta }) => {
        state.pages[meta.arg] = { status: 'loading', ids: [], error: null };
      })
      .addCase(fetchPokemonPage.fulfilled, (state, { payload, meta }) => {
        pokemonAdapter.upsertMany(state, payload.items);
        state.pages[meta.arg] = {
          status: 'succeeded',
          ids: payload.items.map((p) => p.id),
          error: null,
        };
        state.total = payload.total;
      })
      .addCase(fetchPokemonPage.rejected, (state, action) => {
        state.pages[action.meta.arg] = {
          status: 'failed',
          ids: [],
          error: rejectedError(action),
        };
      })
      .addCase(fetchPokemon.pending, (state, { meta }) => {
        state.details[meta.arg] = { status: 'loading', error: null };
      })
      .addCase(fetchPokemon.fulfilled, (state, { payload, meta }) => {
        pokemonAdapter.upsertOne(state, payload);
        state.details[meta.arg] = { status: 'succeeded', error: null };
      })
      .addCase(fetchPokemon.rejected, (state, action) => {
        state.details[action.meta.arg] = {
          status: 'failed',
          error: rejectedError(action),
        };
      });
  },
});

const selectSlice = (state: RootState) => state.pokemon;
// Constantes para que el selector devuelva siempre la misma referencia.
const idleEntry: DetailEntry = { status: 'idle', error: null };
const cachedEntry: DetailEntry = { status: 'succeeded', error: null };

export const { selectById: selectPokemonById } =
  pokemonAdapter.getSelectors(selectSlice);

/** Una página de la lista: estado de su petición y sus Pokémon. */
export const selectPokemonPage = createSelector(
  [
    (state: RootState, page: number) => selectSlice(state).pages[page],
    (state: RootState) => selectSlice(state).entities,
  ],
  (entry, entities) => ({
    status: entry?.status ?? 'idle',
    error: entry?.error ?? null,
    pokemon: (entry?.ids ?? []).flatMap((id) => entities[id] ?? []),
  }),
);

export const selectPageCount = (state: RootState) => {
  const { total } = selectSlice(state);
  return total === null ? null : Math.ceil(total / PAGE_SIZE);
};

/** Estado del detalle de un Pokémon: succeeded si ya está en caché. */
export const selectPokemonRequest = (state: RootState, id: number) =>
  selectSlice(state).entities[id]
    ? cachedEntry
    : (selectSlice(state).details[id] ?? idleEntry);

export const selectIsFetchingPokemon = (state: RootState) => {
  const { pages, details } = selectSlice(state);
  return [...Object.values(pages), ...Object.values(details)].some(
    (entry) => entry.status === 'loading',
  );
};
