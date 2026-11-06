import { test, expect } from '@playwright/test';

// No depende de que la API tenga datos: solo rutas, títulos y navegación.
test('/ abre la lista y la navegación llega a los reportes', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Pokemon');
  await expect(page).toHaveURL(/\/items$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pokédex');

  await page.getByRole('link', { name: 'Reportes', exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/monthly-growth$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reportes');
});
