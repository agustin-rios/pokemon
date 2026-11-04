import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  test: {
    name: '@pokemon/api',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
