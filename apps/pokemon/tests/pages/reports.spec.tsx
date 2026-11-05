import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '../support/renderApp.tsx';

describe('/reports', () => {
  it('abre la consulta A: capturas por mes y la variación marcada', async () => {
    const { router } = renderApp('/reports');

    expect(await screen.findByText('noviembre de 2025')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/reports/monthly-growth');
    expect(screen.getByText('▲ 4,72 %')).toBeTruthy();
    expect(screen.getByText('▼ 18,03 %')).toBeTruthy();
  });

  it('las pestañas navegan a B y C, y cada reporte se pide una sola vez', async () => {
    const { api } = renderApp('/reports/monthly-growth');
    await screen.findByText('noviembre de 2025');

    fireEvent.click(screen.getByRole('tab', { name: 'Top entrenadores' }));
    expect(await screen.findByText('🥇 Ash Ketchum')).toBeTruthy();
    expect(screen.getByText('🥈 Misty Waterflower')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Johto' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Nivel por tipo' }));
    expect(await screen.findByText('13,41 %')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Crecimiento mensual' }));
    await screen.findByText('noviembre de 2025');
    expect(api.getMonthlyGrowth).toHaveBeenCalledTimes(1);
  });
});
