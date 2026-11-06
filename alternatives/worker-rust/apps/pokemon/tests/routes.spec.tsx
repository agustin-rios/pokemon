import { fireEvent, screen } from '@testing-library/react';
import { fakeApi } from './support/fakeApi.ts';
import { renderApp } from './support/renderApp.tsx';

describe('rutas', () => {
  it('/ redirige a /items', async () => {
    const { router } = renderApp('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pokédex' }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/items');
  });

  it('la navegación lleva a los reportes', async () => {
    const { router } = renderApp('/items');

    fireEvent.click(await screen.findByRole('link', { name: 'Reportes' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Reportes' }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/reports/monthly-growth');
  });

  it('una ruta desconocida muestra "no encontrada"', async () => {
    renderApp('/nope');

    expect(
      await screen.findByRole('heading', { name: 'Página no encontrada' }),
    ).toBeTruthy();
  });

  it('muestra el estado de la API', async () => {
    const api = fakeApi();
    api.health.mockRejectedValue(new TypeError('Failed to fetch'));
    renderApp('/items', api);

    expect(await screen.findByText('API: sin conexión')).toBeTruthy();
  });
});
