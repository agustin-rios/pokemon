import { act, fireEvent, screen, within } from '@testing-library/react';
import { dataNotLoaded, fakeApi } from '../support/fakeApi.ts';
import { renderApp } from '../support/renderApp.tsx';

describe('/items', () => {
  it('muestra los Pokémon de la primera página en tarjetas', async () => {
    const { api } = renderApp('/items');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Pokemon 1' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Pokemon 12' }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Pokemon 13' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Pokemon 1' })).toBeTruthy();
    expect(api.listPokemon).toHaveBeenCalledWith(
      { page: 1, pageSize: 12 },
      expect.any(AbortSignal),
    );
  });

  it('muestra el resumen al costado y el acceso a los reportes', async () => {
    renderApp('/items');

    const summary = await screen.findByRole('complementary', {
      name: 'Resumen por tipo',
    });
    expect(await within(summary).findByText('145,08')).toBeTruthy();
    expect(within(summary).getByText('grass')).toBeTruthy();
    expect(
      within(summary)
        .getByRole('link', { name: 'Ver reportes' })
        .getAttribute('href'),
    ).toBe('/reports');
  });

  it('la página sale de ?page= y la paginación son enlaces', async () => {
    const { api } = renderApp('/items?page=2');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Pokemon 13' }),
    ).toBeTruthy();
    expect(api.listPokemon).toHaveBeenCalledWith(
      { page: 2, pageSize: 12 },
      expect.any(AbortSignal),
    );
    expect(
      screen.getByRole('link', { name: 'Go to page 3' }).getAttribute('href'),
    ).toBe('/items?page=3');
  });

  it('volver a una página ya vista no la pide de nuevo', async () => {
    const { api, router } = renderApp('/items');
    await screen.findByRole('heading', { name: 'Pokemon 1' });

    await act(() => router.navigate('/items?page=2'));
    await screen.findByRole('heading', { name: 'Pokemon 13' });
    await act(() => router.navigate('/items'));
    await screen.findByRole('heading', { name: 'Pokemon 1' });

    expect(api.listPokemon).toHaveBeenCalledTimes(2);
  });

  it('sin datos (503) ofrece cargarlos y reintentar', async () => {
    const api = fakeApi();
    api.listPokemon.mockRejectedValueOnce(dataNotLoaded());
    renderApp('/items', api);

    expect(
      await screen.findByText('Los datos todavía no están cargados.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cargar datos' }));
    expect(
      await screen.findByText(
        /Carga iniciada \(3f1c9a52-7d0e-4c58-9a51-0c8f6b2d4e11\)/,
      ),
    ).toBeTruthy();
    expect(api.triggerEtl).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Pokemon 1' }),
    ).toBeTruthy();
  });
});
