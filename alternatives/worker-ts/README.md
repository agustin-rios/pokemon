> [!NOTE]
> **Esta es una alternativa:** reemplaza Apache Airflow por un **worker en TypeScript** que hace todo el pipeline (`scrape → generate → validate → load → build_views`). Vive en `alternatives/worker-ts` del repo principal y es un monorepo autónomo: **todos los comandos se corren desde esta carpeta**.

<div align="center">

# Pokémon Explorer

**PokeAPI → Worker → PostgreSQL → API → Web**

Pokédex full-stack: un worker baja los Pokémon de la PokeAPI, genera los datos sintéticos, los valida y los carga en PostgreSQL, y una web en React los muestra a través de una API propia en NestJS.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Redux Toolkit](https://img.shields.io/badge/Redux_Toolkit-2-764ABC?logo=redux&logoColor=white)
![MUI](https://img.shields.io/badge/MUI-9-007FFF?logo=mui&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker_Compose-v2-2496ED?logo=docker&logoColor=white)

| 🚀 [Cómo correrlo](#-cómo-correrlo) | ⚙️ [El worker](#️-el-worker) | 🐘 [Esquema de la base](#-esquema-de-la-base) | 🧩 [Arquitectura](#-arquitectura) |
| :---------------------------------: | :-------------------------: | :-------------------------------------------: | :-------------------------------: |

</div>

## 🚀 Cómo correrlo

**Requisitos:** Docker con Compose v2, Node 24 (`nvm use`, ver `.nvmrc`) y pnpm 10 (`corepack enable`).

```sh
cp .env.example .env           # 1. variables: puertos, usuarios y claves
docker compose up -d --build   # 2. Postgres, migraciones, worker, API y web
```

**3.** Abrir **http://localhost:8011** y apretar **«Cargar datos»**: encola una corrida y el worker llena la base ([otras formas](#-disparar-una-corrida)).

> [!IMPORTANT]
> La base parte vacía: el worker es la única vía por la que entran datos (no hay seeds ni dumps). Hasta que termine una corrida, cada sección de la web muestra «Cargar datos».

Con los valores de `.env.example`:

| Servicio      | Dónde                            | Credenciales            |
| ------------- | -------------------------------- | ----------------------- |
| Web           | http://localhost:8011            | —                       |
| API           | http://localhost:8011/api        | —                       |
| PostgreSQL 18 | `localhost:5441`, base `pokemon` | `postgres` / `postgres` |

```sh
docker compose logs -f worker   # qué hace el worker, paso a paso
docker compose down             # detiene todo; los datos quedan en el volumen
docker compose down -v          # detiene y borra los datos
```

### Modo desarrollo

La API, el worker y la web corren fuera de Docker, con recarga en caliente; Docker levanta solo la base:

```sh
pnpm install
docker compose -f docker-compose.base.yml up -d   # Postgres y migraciones
pnpm dev                                          # web en http://localhost:4200, API en http://localhost:3000/api y el worker
```

| Archivo                   | Levanta                                                             | Para qué                         |
| ------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| `docker-compose.yml`      | `docker-compose.base.yml` + `api`, `worker` y `web` en contenedores | Correr todo: `docker compose up` |
| `docker-compose.base.yml` | `postgres` y `migrate` (Prisma)                                     | Desarrollar con `pnpm dev`       |

Los dos son el mismo proyecto de compose (`pokemon-worker-ts`), así que comparten contenedores y volumen: lo que cargue el worker se ve en los dos modos. La web en Docker usa el puerto 8011 y `pnpm dev` el 4200 y el 3000, así que pueden estar arriba a la vez. Con los dos modos arriba habría dos workers: no es un problema (una sola corrida activa, el lease evita que se pisen), pero lo normal es usar uno.

<details>
<summary><b>Detalles de Docker</b></summary>

- Ambos archivos leen el `.env` de la raíz (plantilla: `.env.example`); si falta una variable, compose no arranca. `WEB_PORT` y `API_CORS_ALLOW_ORIGINS` solo los usa `docker-compose.yml` (la API en producción no acepta `*`).
- `api` (`apps/api/Dockerfile`), `worker` (`apps/worker/Dockerfile`) y `web` (`apps/pokemon/Dockerfile`) son imágenes de producción: después de cambiar código, `docker compose up -d --build` las reconstruye. La API no publica puerto: se llega por la web en `/api`.
- Las imágenes de la API y del worker conservan la estructura del workspace: Node ejecuta `context/`, `libs/` y `db/main` como TypeScript y no quita tipos dentro de `node_modules`.
- El worker monta `./data` en `/data` con escritura (ahí deja los CSV) y corre como `node` (uid 1000): si `data/` no existe o es de otro usuario, créala antes con tu usuario (`mkdir -p data`).
- `migrate` aplica las migraciones de Prisma, incluidas las tablas de la cola (`etl_runs`, `etl_run_steps`). Usuario, clave y base de Postgres se crean junto con el volumen: para cambiarlos después, `docker compose down -v`.
- El `DATABASE_URL` de `db/main/.env.example`, `apps/api/.env.example` y `apps/worker/.env.example` apunta a este Postgres: si cambias el `.env` de la raíz, actualízalos también.

</details>

## ⚙️ El worker

`apps/worker` es un proceso aparte que espera corridas, toma una y ejecuta todo el pipeline. La API solo **encola** (`POST /api/etl/runs`) y consulta el estado; no ejecuta nada. La lógica está en `context/ingestion` (casos de uso, puertos y adapters); la generación de datos y el cliente de la PokeAPI, en `libs/pokemon-data`.

```mermaid
flowchart LR
  pokeapi(["🌐 PokeAPI"]) --> scrape["🌐 scrape<br/>pokemon, types,<br/>pokemon_types"]
  scrape --> generate["🎲 generate<br/>trainers, captures,<br/>battles"]
  generate --> validate["✅ validate<br/>lee y valida<br/>los 6 CSV"]
  validate --> load["📦 load<br/>TRUNCATE + INSERT<br/>en una transacción"]
  load --> views["🔎 build_views<br/>crea o actualiza<br/>las vistas"]
  scrape -.-> csv[/"📁 data/*.csv"/]
  generate -.-> csv
  csv -.-> validate
  csv -.-> load
  load --> db[("🐘 base pokemon")]
  views --> db

  classDef task fill:#e7f5ff,stroke:#1c7ed6,color:#0b3d6b
  classDef store fill:#f3f0ff,stroke:#7048e8,color:#2e1a6b
  classDef ext fill:#fff4e6,stroke:#f08c00,color:#5c3a00
  class scrape,generate,validate,load,views task
  class csv,db store
  class pokeapi ext
```

1. **`scrape`** baja los Pokémon `1..POKEMON_LIMIT` de la PokeAPI (8 requests a la vez, timeout de 15 s y hasta 4 intentos con espera creciente ante errores de red, 429 y 5xx; respeta `Retry-After`) y escribe `pokemon.csv`, `types.csv` y `pokemon_types.csv` en `DATA_DIR`. Cualquier otro error HTTP corta el paso.
2. **`generate`** crea `trainers.csv`, `captures.csv` y `battles.csv` (50 entrenadores, 5.000 capturas y 2.000 batallas en 12 meses) con los ids de `pokemon.csv`. Es un port exacto del generador Python del desafío: misma semilla (42), mismo generador de números aleatorios de CPython y mismas filas.
3. **`validate`** lee los 6 CSV y los valida. La corrida falla, sin escribir nada, si:
   - falta un archivo, una columna o filas;
   - un valor está vacío o no se puede leer;
   - se repite un id o una clave única;
   - una referencia apunta a un id que no existe (`pokemon_id` y `trainer_id` de `captures.csv`, y las demás FK);
   - una fila de `types`, `pokemon`, `pokemon_types` o `trainers` rompe una regla de la base.

   En `captures` y `battles`, que ninguna tabla referencia, una fila que rompe una regla se descarta y queda en el log y en el `output` del paso (el generador produce algunas batallas con duración negativa). Un `base_experience` vacío se carga como 0, el default de la columna. La columna `sprite` del CSV se carga en `sprite_url`.

4. **`load`** vacía las 6 tablas y las carga en orden de FK en una sola transacción. Es **idempotente**: otra corrida deja exactamente los mismos datos, y si algo falla la base queda como estaba.
5. **`build_views`** crea o actualiza las vistas con `db/main/sql/views.sql`.

Cada escritura de CSV es atómica (todos los archivos del paso o ninguno), así que un fallo nunca deja `data/` a medias. `data/` no se versiona.

### La cola

La tabla `etl_runs` es también la cola: no hay broker aparte.

- **Una sola corrida activa.** Un índice único parcial impide tener dos corridas `queued` o `running` a la vez. `POST /api/etl/runs` crea una corrida con sus 5 pasos (`etl_run_steps`) en una transacción; si ya hay una activa, devuelve esa.
- **Tomar una corrida.** El worker hace `UPDATE … FOR UPDATE SKIP LOCKED` sobre la corrida más antigua que esté en cola (con `run_after` cumplido) o `running` con el lease vencido. Dos workers nunca toman la misma.
- **Aviso o consulta.** Un trigger hace `NOTIFY etl_runs` cuando una corrida queda en cola y el worker, que escucha con `LISTEN` en una conexión propia, la toma al instante. Es solo una señal para intentar tomar: igual consulta cada `POLL_SECONDS`, así que si se pierde un aviso (o la conexión de `LISTEN` se cae y se reconecta) la corrida se toma igual, un poco más tarde.
- **Lease.** Al tomarla, el worker queda como dueño (`locked_by`, `locked_until`) durante `LEASE_SECONDS` y lo renueva cada `LEASE_SECONDS / 3` con un timer independiente. `attempts` crece en cada toma y, junto con el id del worker, es el token que exige cada escritura: si otro worker retoma la corrida, el anterior deja de ejecutar y de escribir (también `load` lo verifica justo antes de confirmar su transacción).
- **Retomar.** Los pasos terminados (`succeeded`) no se repiten. Si el worker muere a mitad de camino, el lease vence y otro (o el mismo, al reiniciar) retoma la corrida desde el paso interrumpido. Si la corrida agotó sus intentos (`max_attempts`, 3) queda `failed`.
- **Errores.** Un error **reintentable** (red, timeouts, la base caída, HTTP 429 o 5xx) devuelve la corrida a la cola con espera de 5, 10, 20… hasta 60 s. Uno **permanente** (CSV inválido, HTTP 4xx, violación de una restricción de la base) la deja `failed` de inmediato.
- **Reintento manual.** `POST /api/etl/runs/:runId/retry` vuelve a encolar una corrida `failed` conservando el estado de sus pasos: retoma desde el paso que falló, no desde cero. Típico: falla `validate` por un CSV mal formado, lo arreglas en `data/` y reintentas.
- **Apagado.** Con SIGINT/SIGTERM deja de tomar corridas y le da hasta 10 s al paso en curso; si no termina, lo abandona (el lease vence y otro worker retoma). El servicio `worker` de Compose usa `stop_grace_period: 20s` para que Docker no lo mate antes.

### Variables del worker

Se validan al arrancar con Zod (`apps/worker/src/env.ts`); si alguna es inválida, el worker no arranca. Plantilla: `apps/worker/.env.example`.

| Variable        | Default                                                 | Qué es                                                   |
| --------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`  | `postgresql://postgres:postgres@localhost:5441/pokemon` | Base de la app                                           |
| `DATA_DIR`      | `data/` de la raíz (en el contenedor, `/data`)          | Carpeta de los CSV                                       |
| `POKEAPI_URL`   | `https://pokeapi.co/api/v2`                             | Base de la PokeAPI                                       |
| `POKEMON_LIMIT` | `100`                                                   | Pokémon `1..n` que baja `scrape` (2 a 1025)              |
| `WORKER_ID`     | `<host>:<pid>:<8 hex>`                                  | Identifica al worker en el lease                         |
| `LEASE_SECONDS` | `30`                                                    | Duración del lease                                       |
| `POLL_SECONDS`  | `5`                                                     | Cada cuánto busca una corrida aunque no le hayan avisado |

### Datos a mano (`pnpm ops`)

El mismo código que usa el worker está en la CLI, por si quieres los CSV sin pasar por la base (por ejemplo para inspeccionarlos). Escriben en `data/`:

```sh
pnpm ops data scrape      # PokeAPI → pokemon.csv, types.csv, pokemon_types.csv (Pokémon 1–100; --limit para otro n)
pnpm ops data generate    # los ids de data/pokemon.csv → trainers.csv, captures.csv, battles.csv
pnpm ops data prepare     # los dos en cadena: data/ cambia solo si ambos terminan
pnpm ops help
```

| CSV                 | Origen                                  | Columnas                                                                           |
| ------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `pokemon.csv`       | PokeAPI                                 | `id`, `name`, `height`, `weight`, `base_experience`, `sprite`                      |
| `types.csv`         | PokeAPI                                 | `id`, `name`                                                                       |
| `pokemon_types.csv` | PokeAPI                                 | `pokemon_id`, `type_id`, `slot`                                                    |
| `trainers.csv`      | generador (50 entrenadores, 6 regiones) | `id`, `name`, `region`, `created_at`                                               |
| `captures.csv`      | generador (5.000 en 12 meses)           | `id`, `trainer_id`, `pokemon_id`, `captured_at`, `level`, `location`               |
| `battles.csv`       | generador (2.000)                       | `id`, `pokemon_a_id`, `pokemon_b_id`, `winner_id`, `fought_at`, `duration_seconds` |

## ⚡ Disparar una corrida

El worker no tiene schedule: la corrida se encola a mano, de cualquiera de estas formas. Tarda unos segundos (con la PokeAPI real, algo más).

| Desde  | Cómo                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| 🖱️ Web | http://localhost:8011 → **«Cargar datos»** (aparece con la base vacía); a los pocos segundos, «Reintentar» |
| 🌐 API | `curl -X POST http://localhost:8011/api/etl/runs` → `202` con la corrida (con `pnpm dev`, puerto `3000`)   |

Para ver cómo va (cada paso con su estado, intentos, error y `output`) y para reintentar una corrida fallida:

```sh
curl http://localhost:8011/api/etl/runs/<runId>
curl -X POST http://localhost:8011/api/etl/runs/<runId>/retry
```

## 🐘 Esquema de la base

Tablas y constraints en las migraciones de Prisma (`db/main/prisma`); vistas en `db/main/sql/views.sql`, que crea el worker (contrato en [context/pokedex](context/pokedex/README.md)).

```mermaid
erDiagram
  types {
    int id PK
    text name UK
  }
  pokemon {
    int id PK "n° de Pokédex"
    text name UK
    int height
    int weight
    int base_experience "default 0"
    text sprite_url "nullable"
  }
  pokemon_types {
    int pokemon_id PK, FK
    int type_id PK, FK
    smallint slot "1 o 2"
  }
  trainers {
    int id PK
    text name
    text region
    date created_at
  }
  captures {
    int id PK
    int trainer_id FK
    int pokemon_id FK
    timestamp captured_at
    smallint level "1 a 100"
    text location
  }
  battles {
    int id PK
    int pokemon_a_id FK
    int pokemon_b_id FK
    int winner_id FK "A o B"
    timestamp fought_at
    int duration_seconds
  }

  types ||--o{ pokemon_types : "type_id"
  pokemon ||--|{ pokemon_types : "pokemon_id"
  trainers ||--o{ captures : "trainer_id"
  pokemon ||--o{ captures : "pokemon_id"
  pokemon ||--o{ battles : "pokemon_a_id, pokemon_b_id, winner_id"
```

| Tabla           | Clave primaria            | Claves foráneas                                         | Reglas                                                                  |
| --------------- | ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `types`         | `id`                      | —                                                       | `name` único y no vacío                                                 |
| `pokemon`       | `id` (n° de Pokédex)      | —                                                       | `name` único y no vacío; `height` y `weight` > 0; `base_experience` ≥ 0 |
| `pokemon_types` | (`pokemon_id`, `type_id`) | → `pokemon`, → `types`                                  | (`pokemon_id`, `slot`) único; `slot` 1 o 2, y el 2 exige el 1           |
| `trainers`      | `id`                      | —                                                       | `name` y `region` no vacíos                                             |
| `captures`      | `id`                      | → `trainers`, → `pokemon`                               | `level` entre 1 y 100; `location` no vacía                              |
| `battles`       | `id`                      | `pokemon_a_id`, `pokemon_b_id`, `winner_id` → `pokemon` | A ≠ B; el ganador es A o B; `duration_seconds` ≥ 0                      |

La cola del worker (`etl_runs` y `etl_run_steps`) vive en la misma base; no la lee ninguna vista:

```mermaid
erDiagram
  etl_runs {
    uuid id PK
    text status "queued, running, succeeded o failed"
    int attempts "ejecuciones (token del lease)"
    int max_attempts "default 3"
    timestamptz run_after "no tomar antes de esta hora"
    text locked_by "worker dueño del lease"
    timestamptz locked_until "vencimiento del lease"
    text error
    timestamptz created_at
    timestamptz started_at
    timestamptz finished_at
  }
  etl_run_steps {
    uuid run_id PK, FK
    text step PK "scrape, generate, validate, load o build_views"
    smallint position "1 a 5"
    text status "pending, running, succeeded o failed"
    int attempts
    text error
    jsonb output "resumen del paso"
    timestamptz started_at
    timestamptz finished_at
  }

  etl_runs ||--|{ etl_run_steps : "run_id"
```

Un índice único parcial deja **una sola corrida activa** (`queued` o `running`) a la vez; un trigger hace `NOTIFY etl_runs` cuando una corrida queda en cola.

Vistas (las agregaciones corren en Postgres; la API solo las lee):

| Vista                          | Endpoint                            | Qué calcula                                                                         |
| ------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------- |
| `type_summary`                 | `GET /items/summary`                | Por tipo: cantidad de Pokémon y experiencia base promedio                           |
| `capture_monthly_growth`       | `GET /reports/monthly-growth`       | **Consulta A**: capturas por mes y % de cambio vs. el mes anterior                  |
| `top_trainers_by_region`       | `GET /reports/top-trainers`         | **Consulta B**: top 3 entrenadores por capturas en cada región (función de ventana) |
| `level_classification_by_type` | `GET /reports/level-classification` | **Consulta C**: por tipo, capturas con nivel ≥ 50 y su porcentaje                   |

## 🧩 Arquitectura

```mermaid
flowchart LR
  user(["👤 Usuario"])
  pokeapi(["🌐 PokeAPI"])

  subgraph compose["🐳 docker compose · proyecto pokemon-worker-ts"]
    web["web · :8011<br/>nginx + React SPA"]
    api["api<br/>NestJS · /api"]
    worker["worker<br/>Node 24 · pipeline"]
    migrate["migrate<br/>migraciones Prisma"]
    data[/"📁 data/<br/>6 CSV"/]
    subgraph pg["🐘 PostgreSQL 18 · :5441"]
      dbapp[("base pokemon<br/>tablas + vistas<br/>cola etl_runs")]
    end
  end

  user -->|HTTP| web
  web -->|"proxy /api"| api
  api -->|"lee tablas y vistas"| dbapp
  api -->|"POST /etl/runs →<br/>encola la corrida"| dbapp
  dbapp -.->|"NOTIFY etl_runs"| worker
  worker -->|"toma la corrida<br/>(SKIP LOCKED + lease)"| dbapp
  worker --> pokeapi
  worker <-->|"escribe y lee"| data
  worker -->|"load + build_views"| dbapp
  migrate -->|"crea tablas,<br/>constraints y la cola"| dbapp

  classDef ext fill:#fff4e6,stroke:#f08c00,color:#5c3a00
  classDef app fill:#e7f5ff,stroke:#1c7ed6,color:#0b3d6b
  classDef etl fill:#ebfbee,stroke:#2f9e44,color:#14532d
  classDef store fill:#f3f0ff,stroke:#7048e8,color:#2e1a6b
  class user,pokeapi ext
  class web,api app
  class worker,migrate etl
  class data,dbapp store
```

- **Orden de arranque:** Postgres sano → `migrate` aplica las migraciones de Prisma (tablas, constraints y la cola `etl_*`) y termina → API, worker y web. El worker no crea tablas: solo carga datos y crea las vistas.
- **Una sola base:** `pokemon`. El worker escribe (datos y estado de las corridas) y la API lee y encola.
- **Una sola definición de las vistas:** `db/main/sql/views.sql`. El worker las crea con ese archivo (`db/main` lo exporta como `viewsSqlPath`) y la API las lee; un test de contrato en `context/pokedex` verifica que ambos lados calcen.
- **Web** (`apps/pokemon`): SPA de Vite con React Router (`/items`, `/item/:id` y `/reports/*`), estado y caché de respuestas en Redux Toolkit, UI con MUI. Habla con la API solo por HTTP en `/api` (en Docker, nginx la reenvía; en dev, el proxy de Vite a `:3000`).
- **API** (`apps/api`): NestJS. Lee la base con los repositorios de `context/pokedex` y encola y consulta corridas con los casos de uso de `context/ingestion`; no ejecuta el pipeline.
- **Worker** (`apps/worker`): arma los casos de uso de `context/ingestion` con sus adapters y corre el ciclo de la cola.

### Código (monorepo Nx con pnpm)

```mermaid
flowchart LR
  web["apps/pokemon<br/>React · RTK · MUI"]
  api["apps/api<br/>NestJS"]
  worker["apps/worker<br/>ciclo de la cola"]
  ops["platform/ops<br/>CLI"]
  subgraph ctx["contexts · hexagonales"]
    direction LR
    pokedex["context/pokedex<br/>catálogo y reportes"]
    ingestion["context/ingestion<br/>pipeline y cola"]
  end
  lib["libs/pokemon-data<br/>PokeAPI, generador, CSV"]
  db["db/main<br/>Prisma: schema,<br/>migraciones y cliente"]

  web -.->|"solo tipos"| pokedex
  api --> pokedex
  api --> ingestion
  worker --> ingestion
  ops --> lib
  pokedex --> db
  ingestion --> db
  ingestion --> lib

  classDef app fill:#e7f5ff,stroke:#1c7ed6,color:#0b3d6b
  classDef core fill:#ebfbee,stroke:#2f9e44,color:#14532d
  classDef store fill:#f3f0ff,stroke:#7048e8,color:#2e1a6b
  class web,api,worker,ops app
  class pokedex,ingestion,lib core
  class db store
```

| Proyecto                     | Ruta                | Qué es                                                                                 |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| `@pokemon/pokemon`           | `apps/pokemon`      | Web (SPA): React 19 · Vite 8 · React Router 8 · Redux Toolkit · MUI 9                  |
| `@pokemon/api`               | `apps/api`          | API: NestJS 12 (ESM) · Zod                                                             |
| `@pokemon/worker`            | `apps/worker`       | Worker: ciclo de la cola y armado del pipeline (Node 24, sin compilar)                 |
| `@pokemon/pokemon-e2e`       | `apps/pokemon-e2e`  | Tests e2e (Playwright)                                                                 |
| `@pokemon/context-pokedex`   | `context/pokedex`   | Catálogo y reportes, solo lectura ([README](context/pokedex/README.md))                |
| `@pokemon/context-ingestion` | `context/ingestion` | Pipeline, validación de los CSV y cola ([README](context/ingestion/README.md))         |
| `@pokemon/pokemon-data`      | `libs/pokemon-data` | Cliente de la PokeAPI, generador sintético (port de CPython), lector y escritor de CSV |
| `@pokemon/db-main`           | `db/main`           | Prisma 7 + PostgreSQL ([README](db/main/README.md))                                    |
| `@pokemon/ops`               | `platform/ops`      | CLI de operaciones (`pnpm ops`)                                                        |

Además: `data/` (los CSV, no se versiona).

- **app** (`apps/`):
  - `pokemon` (web): estado en Redux Toolkit (`src/app/store.ts`, un slice por feature en `src/features/`), rutas en `src/routes.tsx`. De `context/pokedex` importa solo tipos (no entran al bundle), así web y API comparten el contrato.
  - `api`: es quien arma los casos de uso de un context con sus adapters, un módulo por área en `src/modules/`. Prefijo global `/api`. El entorno se valida con Zod al arrancar (`src/config/env.ts`, variables en `apps/api/.env.example`); si no cumple, no arranca. El input de una ruta se valida con un schema de Zod: `@Query({ schema })`, `@Body({ schema })` (pipe global `StandardSchemaValidationPipe`).
  - `worker`: `src/main.ts` arma los adapters y los pasos; `src/loop.ts` es el ciclo (tomar, ejecutar, esperar aviso o consulta, apagado); `src/env.ts` valida el entorno.
- **context** (`context/<nombre>`): `domain` → `application` (ports y casos de uso) → `infra/adapters` (Repository Pattern sobre Prisma, `pg` y el sistema de archivos). Un context no importa a otro.
- **db** (`db/<nombre>`): schema, migraciones y cliente de Prisma.
- **lib** (`libs/`): código compartido y sin dependencias de infraestructura.
- **platform** (`platform/`): lo operativo, que no importa nadie: `ops` (CLI, tag `tool`).
- Los tests de cada proyecto van en `tests/`, espejo de `src/`.

Los límites los aplica `@nx/enforce-module-boundaries` (`eslint.config.mjs`) según los tags `type:` (`app`, `e2e`, `context`, `db`, `lib`, `tool`) de `nx.tags` en el `package.json` de cada proyecto. Un proyecto sin tags no puede importar nada.

## 🔌 API

`apps/api`, prefijo `/api` (en Docker, `http://localhost:8011/api`; con `pnpm dev`, `http://localhost:3000/api`). Lee la base `pokemon` (`DATABASE_URL`).

| Endpoint                            | Devuelve                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `GET /items?page=&pageSize=`        | Pokémon con sus tipos, paginado (`page` ≥ 1, `pageSize` 1–100, default 20)  |
| `GET /items/:id`                    | Un Pokémon con sus tipos                                                    |
| `GET /items/summary`                | Por tipo: cantidad de Pokémon y experiencia base promedio                   |
| `GET /reports/monthly-growth`       | Consulta A: capturas por mes y % de cambio vs. el mes anterior              |
| `GET /reports/top-trainers`         | Consulta B: top 3 entrenadores por capturas en cada región                  |
| `GET /reports/level-classification` | Consulta C: por tipo, capturas con nivel ≥ 50 y su porcentaje               |
| `POST /etl/runs`                    | Encola una corrida (o devuelve la activa); `202` con la corrida             |
| `GET /etl/runs/:runId`              | La corrida con sus 5 pasos (estado, intentos, error y `output` de cada uno) |
| `POST /etl/runs/:runId/retry`       | Vuelve a encolar una corrida fallida; `202` con la corrida                  |

| Caso                                                               | Código |
| ------------------------------------------------------------------ | :----: |
| Entrada inválida (incl. un `runId` que no es UUID)                 | `400`  |
| Id o corrida inexistente                                           | `404`  |
| Reintentar una corrida que no está fallida, o con otra ya en curso | `409`  |
| Datos aún no disponibles (la vista no existe)                      | `503`  |
| No se pudo encolar tras 3 intentos                                 | `500`  |

## 🔧 Desarrollo

```sh
pnpm install
pnpm dev          # web en http://localhost:4200, API en http://localhost:3000/api y el worker (con docker-compose.base.yml arriba)
pnpm build        # build de todos los proyectos
pnpm test         # tests unitarios (Vitest y node --test en ops)
pnpm lint
pnpm typecheck
pnpm e2e          # Playwright (chromium, firefox, webkit)
```

- Para un proyecto o target puntual: `pnpm nx run <proyecto>:<target>`. Lista de targets: `pnpm nx show project <proyecto>`.
- La primera vez en una máquina, para el e2e: `pnpm exec playwright install --with-deps` (descarga los navegadores e instala sus librerías de sistema; pide sudo).
- **Tests con base de datos:** los de `context/ingestion/tests/infra` (cola, loader, vistas, `LISTEN`) y el contrato de `context/pokedex` necesitan un Postgres; sin `TEST_DATABASE_URL` se saltan. Cada archivo crea su propio schema y lo borra al terminar:

  ```sh
  docker run -d --rm --name pokemon-test-pg -e POSTGRES_PASSWORD=postgres -p 55441:5432 postgres:18-alpine
  TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55441/postgres pnpm test
  docker stop pokemon-test-pg
  ```

- Cambios en `db/main/prisma/schema.prisma`: `pnpm nx run @pokemon/db-main:generate` regenera el cliente. El índice único parcial, los CHECK y el trigger de `etl_runs` viven solo en el SQL de la migración (Prisma no los modela).

<details>
<summary><b>Notas</b></summary>

- Nuevo context: `pnpm nx g @nx/js:lib context/<nombre> --name=@pokemon/context-<nombre> --bundler=none --unitTestRunner=vitest --linter=eslint --tags=type:context,scope:<nombre>`; para consumirlo, agrégalo con `workspace:*` al `package.json` de quien lo use y corre `pnpm nx sync`.
- Los targets los infieren los plugins de `nx.json`. Declarados a mano: `generate` (cliente de Prisma, antes de `build`, `dev`, `test` y `typecheck` de quien dependa de `db`), en la API `build`/`dev`/`start` (scripts de su `package.json`; Nest CLI compila con `tsc` a `apps/api/dist`) y en el worker `dev`/`start`.
- El worker y los contexts no se compilan: Node 24 ejecuta su TypeScript quitando los tipos, así que solo usan sintaxis borrable (sin enums ni parameter properties) e `import type`.
- La API es ESM, como el resto: imports relativos con `.ts`, que `tsc` reescribe a `.js` (`rewriteRelativeImportExtensions`). Vitest (Oxc) emite la metadata de los decoradores, así que la inyección por tipo funciona en los tests sin SWC.
- Nx, TypeScript, ESLint y Vitest se actualizan con `pnpm nx migrate latest`, para no adelantarse a lo que soportan los plugins de Nx. `prisma` va fijo a `^7`: en npm, `latest` apunta a un release candidate de la 8.

</details>
