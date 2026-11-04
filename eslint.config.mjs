import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/build',
      '**/.react-router',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      '**/test-output',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          // type: app (compone) → context (dominio hexagonal) → db (Prisma) → lib (compartido).
          // Nadie importa apps ni e2e, y un context no importa a otro: lo que cruza lo compone la app.
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:context', 'type:db', 'type:lib'],
            },
            { sourceTag: 'type:e2e', onlyDependOnLibsWithTags: ['type:lib'] },
            {
              sourceTag: 'type:context',
              onlyDependOnLibsWithTags: ['type:db', 'type:lib'],
            },
            { sourceTag: 'type:db', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:lib', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:tool', onlyDependOnLibsWithTags: ['type:lib'] },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
