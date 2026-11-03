# Pokemon

Monorepo Nx con pnpm.

| Proyecto               | Ruta               | Stack                                                        |
| ---------------------- | ------------------ | ------------------------------------------------------------ |
| `@pokemon/pokemon`     | `apps/pokemon`     | React 19 · React Router 8 (framework, SSR) · Vite 8 · Vitest |
| `@pokemon/pokemon-e2e` | `apps/pokemon-e2e` | Playwright                                                   |

## Requisitos

Node 24 (`nvm use`, ver `.nvmrc`) y pnpm 10 (`corepack enable`).

## Comandos

```sh
pnpm install
pnpm dev          # app en http://localhost:4200
pnpm build        # build de todos los proyectos
pnpm test         # tests unitarios (Vitest)
pnpm lint
pnpm typecheck    # genera los tipos de rutas de React Router antes de tsc
pnpm e2e          # Playwright (chromium, firefox, webkit)
```

Para un proyecto o target puntual: `pnpm nx run @pokemon/pokemon:<target>`. Lista de targets: `pnpm nx show project @pokemon/pokemon`.

La primera vez en una máquina, para el e2e: `pnpm exec playwright install --with-deps` (descarga los navegadores e instala sus librerías de sistema; pide sudo).

## Notas

- Los targets los infieren los plugins de `nx.json`; los únicos declarados a mano son `typegen` y la dependencia `typecheck → typegen` en `apps/pokemon/package.json`.
- Límites entre proyectos (`eslint.config.mjs`): cada proyecto declara `type:` (`app`, `e2e`, `lib`) y `scope:` (`pokemon`, `shared`) en `nx.tags` de su `package.json`. Apps y e2e solo importan libs; un proyecto sin tags no puede importar nada.
- Nx, TypeScript, ESLint y Vitest se actualizan con `pnpm nx migrate latest`, para no adelantarse a lo que soportan los plugins de Nx.
