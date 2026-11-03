import { test, expect } from '@playwright/test';

test('home renders and navigates to about', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Pokemon');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pokemon');

  await page.getByRole('link', { name: 'Acerca de' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Acerca de');
});
