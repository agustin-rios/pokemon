import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { makeStore } from '../src/app/store.ts';
import { routes } from '../src/routes.tsx';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Provider store={makeStore()}>
      <RouterProvider router={router} />
    </Provider>,
  );
}

describe('rutas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('el inicio muestra el estado de la API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ status: 'ok' })),
    );

    renderAt('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pokemon' }),
    ).toBeTruthy();
    expect(await screen.findByText('API: conectada')).toBeTruthy();
  });

  it('avisa si la API no responde', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    renderAt('/');

    expect(await screen.findByText('API: sin conexión')).toBeTruthy();
  });

  it('navega a Acerca de', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ status: 'ok' })),
    );
    renderAt('/');

    fireEvent.click(await screen.findByRole('link', { name: 'Acerca de' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acerca de' }),
    ).toBeTruthy();
  });
});
