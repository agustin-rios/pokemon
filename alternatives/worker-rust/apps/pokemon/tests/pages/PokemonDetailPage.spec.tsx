import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '../support/renderApp.tsx';

describe('/item/:id', () => {
  it('muestra el Pokémon con sus tipos y datos en m y kg', async () => {
    const { api } = renderApp('/item/6');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pokemon 6' }),
    ).toBeTruthy();
    expect(screen.getByText('fire')).toBeTruthy();
    expect(screen.getByText('flying')).toBeTruthy();
    expect(screen.getByText('0,7 m')).toBeTruthy();
    expect(screen.getByText('6,9 kg')).toBeTruthy();
    expect(api.getPokemon).toHaveBeenCalledWith(6, expect.any(AbortSignal));
  });

  it('un id inexistente muestra que no existe', async () => {
    renderApp('/item/999');

    expect(await screen.findByText('No existe el Pokémon «999».')).toBeTruthy();
  });

  it('un id inválido no consulta la API', async () => {
    const { api } = renderApp('/item/abc');

    expect(await screen.findByText('No existe el Pokémon «abc».')).toBeTruthy();
    expect(api.getPokemon).not.toHaveBeenCalled();
  });

  it('desde la lista se abre sin pedirlo y vuelve a la misma página', async () => {
    const { api, router } = renderApp('/items?page=2');

    fireEvent.click(
      await screen.findByRole('heading', { level: 2, name: 'Pokemon 14' }),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pokemon 14' }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/item/14');
    expect(api.getPokemon).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('link', { name: '← Volver a la lista' })
        .getAttribute('href'),
    ).toBe('/items?page=2');
  });
});
