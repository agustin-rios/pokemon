import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { getReadyUrl, workspaceRoot } from '@nx/devkit';

// En CI se puede apuntar a un despliegue con BASE_URL; si no, al dev server
// (getReadyUrl toma el puerto que reporta la tarea de Nx).
const baseURL = process.env['BASE_URL'] || getReadyUrl('http://localhost:4200');

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec nx run @pokemon/pokemon:dev',
    url: getReadyUrl('http://localhost:4200'),
    reuseExistingServer: true,
    cwd: workspaceRoot,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
