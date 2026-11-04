# Pokemon

Monorepo Nx con pnpm.

| Proyecto                   | Ruta               | Qué es                                                            |
| -------------------------- | ------------------ | ----------------------------------------------------------------- |
| `@pokemon/pokemon`         | `apps/pokemon`     | App web: React 19 · React Router 8 (framework, SSR) · Vite 8      |
| `@pokemon/pokemon-e2e`     | `apps/pokemon-e2e` | Tests e2e (Playwright)                                            |
| `@pokemon/context-pokedex` | `context/pokedex`  | Lógica de negocio hexagonal ([README](context/pokedex/README.md)) |
| `@pokemon/db-main`         | `db/main`          | Prisma 7 + PostgreSQL ([README](db/main/README.md))               |
| `@pokemon/ops`             | `platform/ops`     | CLI de operaciones (`pnpm ops`), sin dependencias                 |

## Requisitos

Node 24 (`nvm use`, ver `.nvmrc`), pnpm 10 (`corepack enable`) y Docker.

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

## Servicios (Docker)

`docker-compose.yml` (proyecto `pokemon`) levanta hoy PostgreSQL y Apache Airflow con la imagen oficial; el backend y el frontend se suman ahí mismo.

| Servicio      | Dónde                          | Credenciales            |
| ------------- | ------------------------------ | ----------------------- |
| PostgreSQL 18 | `localhost:5434`, db `pokemon` | `postgres` / `postgres` |
| Airflow 3.3.2 | http://localhost:8080          | `airflow` / `airflow`   |

```sh
docker compose up -d      # la primera vez descarga ~2.6 GB de imágenes; Airflow tarda ~1 min en quedar listo
docker compose down       # detiene; los datos quedan en el volumen
docker compose down -v    # detiene y borra los datos
```

- Un solo Postgres con dos bases: `pokemon` (la app) y `airflow` (estado interno de Airflow, creada al iniciar el volumen).
- Airflow corre en modo `standalone`: UI/API, scheduler, dag-processor y triggerer en un contenedor, con LocalExecutor. Es el modo de Airflow para desarrollo local; si un componente se cae, el contenedor sigue arriba y queda `unhealthy` (`docker compose restart airflow`).
- Los DAGs van en `platform/airflow/dags/`. Un archivo nuevo tarda hasta 5 min en aparecer (los existentes se re-leen cada 30 s); para no esperar: `docker compose exec airflow airflow dags reserialize`.
- Puertos configurables con `POSTGRES_PORT` y `AIRFLOW_PORT` (en un `.env` en la raíz).
- El `DATABASE_URL` de `db/main/.env.example` apunta a este Postgres.

## Estructura de datos

| Carpeta                  | Para qué                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `data/`                  | CSV de entrada que lee Airflow (no se versiona)                                            |
| `scripts/`               | Scripts que producen esos CSV                                                              |
| `platform/airflow/dags/` | DAGs de Airflow                                                                            |
| `platform/ops/`          | CLI `pnpm ops`: comandos en `src/commands/` (registrados en `index.ts`), tests en `tests/` |

```sh
pnpm ops data scrape      # PokeAPI → data/pokemon.csv, types.csv, pokemon_types.csv (Pokémon 1–100; --limit para otro n)
pnpm ops help
```

## Arquitectura

- **app**: hoy no depende de ningún context ni db. Si se conecta, el armado (casos de uso + adapters) va en `app/.server/`, que React Router nunca incluye en el bundle del navegador.
- **context** (`context/<nombre>`): `domain` → `application` (ports y casos de uso) → `infra/adapters`. Un context no importa a otro.
- **db** (`db/<nombre>`): schema, migraciones y cliente de Prisma. (`data/` queda para los CSV que consume Airflow.)
- **lib** (`libs/`): código compartido.
- **platform** (`platform/`): lo operativo, que no importa nadie: `ops` (CLI, tag `tool`) y `airflow` (DAGs en Python).

Los límites los aplica `@nx/enforce-module-boundaries` (`eslint.config.mjs`) según los tags `type:` (`app`, `e2e`, `context`, `db`, `lib`, `tool`) de `nx.tags` en el `package.json` de cada proyecto. Un proyecto sin tags no puede importar nada.

Nuevo context: `pnpm nx g @nx/js:lib context/<nombre> --name=@pokemon/context-<nombre> --bundler=none --unitTestRunner=vitest --linter=eslint --tags=type:context,scope:<nombre>`; para consumirlo, agrégalo con `workspace:*` al `package.json` de quien lo use y corre `pnpm nx sync`.

## Notas

- Los targets los infieren los plugins de `nx.json`. Declarados a mano: `typegen` (tipos de rutas de React Router, antes del `typecheck` de la app) y `generate` (cliente de Prisma, antes de `build`, `dev`, `test` y `typecheck` de quien dependa de `db`).
- Nx, TypeScript, ESLint y Vitest se actualizan con `pnpm nx migrate latest`, para no adelantarse a lo que soportan los plugins de Nx. `prisma` va fijo a `^7`: en npm, `latest` apunta a un release candidate de la 8.
