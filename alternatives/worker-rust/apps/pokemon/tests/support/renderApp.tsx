import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { RouterProvider, createMemoryRouter } from 'react-router';
import type { PokedexApi } from '../../src/api/pokedexApi.ts';
import { makeStore } from '../../src/app/store.ts';
import { routes } from '../../src/routes.tsx';
import { fakeApi } from './fakeApi.ts';

/** Monta la app completa (rutas + store) en `path`, con la API falsa dada. */
export function renderApp(path: string, api: PokedexApi = fakeApi()) {
  const store = makeStore({ api });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>,
  );
  return { store, router, api };
}
