# Pokemon

Monorepo Nx con pnpm.

| Proyecto                   | Ruta               | Qué es                                                            |
| -------------------------- | ------------------ | ----------------------------------------------------------------- |
| `@pokemon/pokemon`         | `apps/pokemon`     | App web: React 19 · React Router 8 (framework, SSR) · Vite 8      |
| `@pokemon/pokemon-e2e`     | `apps/pokemon-e2e` | Tests e2e (Playwright)                                            |
| `@pokemon/context-pokedex` | `context/pokedex`  | Lógica de negocio hexagonal ([README](context/pokedex/README.md)) |
| `@pokemon/data-main`       | `data/main`        | Prisma 7 + PostgreSQL ([README](data/main/README.md))             |

## Requisitos

Node 24 (`nvm use`, ver `.nvmrc`) y pnpm 10 (`corepack enable`).

## Comandos

```sh
pnpm install
pnpm dev          # app en http://localhost:4200
pnpm build        # build de todos los proyectos
pnpm test         # tests unitarios (Vitest)
pnpm lint
pnpm typecheck
pnpm e2e          # Playwright (chromium, firefox, webkit)
```

Para un proyecto o target puntual: `pnpm nx run <proyecto>:<target>`. Lista de targets: `pnpm nx show project <proyecto>`.

La primera vez en una máquina, para el e2e: `pnpm exec playwright install --with-deps` (descarga los navegadores e instala sus librerías de sistema; pide sudo).

## Arquitectura

- **app**: hoy no depende de ningún context ni data. Si se conecta, el armado (casos de uso + adapters) va en `app/.server/`, que React Router nunca incluye en el bundle del navegador.
- **context** (`context/<nombre>`): `domain` → `application` (ports y casos de uso) → `infra/adapters`. Un context no importa a otro.
- **data** (`data/<nombre>`): schema, migraciones y cliente de Prisma.
- **lib** (`libs/`): código compartido.

Los límites los aplica `@nx/enforce-module-boundaries` (`eslint.config.mjs`) según los tags `type:` (`app`, `e2e`, `context`, `data`, `lib`) de `nx.tags` en el `package.json` de cada proyecto. Un proyecto sin tags no puede importar nada.

Nuevo context o data: `pnpm nx g @nx/js:lib context/<nombre> --name=@pokemon/context-<nombre> --bundler=none --unitTestRunner=vitest --linter=eslint --tags=type:context,scope:<nombre>`; para consumirlo, agrégalo con `workspace:*` al `package.json` de quien lo use y corre `pnpm nx sync`.

## Notas

- Los targets los infieren los plugins de `nx.json`. Declarados a mano: `typegen` (tipos de rutas de React Router, antes del `typecheck` de la app) y `generate` (cliente de Prisma, antes de `build`, `dev`, `test` y `typecheck` de quien dependa de `data`).
- Nx, TypeScript, ESLint y Vitest se actualizan con `pnpm nx migrate latest`, para no adelantarse a lo que soportan los plugins de Nx. `prisma` va fijo a `^7`: en npm, `latest` apunta a un release candidate de la 8.
