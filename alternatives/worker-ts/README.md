> [!NOTE]
> **Esta es una alternativa:** reemplaza Apache Airflow por un **worker en TypeScript** (NestJS + BullMQ sobre Redis) que hace todo el pipeline (`scrape → generate → validate → load → build_views`). Vive en `alternatives/worker-ts` del repo principal y es un monorepo autónomo: **todos los comandos se corren desde esta carpeta**. No hay archivos CSV: los datos pasan por tablas de staging en Postgres.

<div align="center">

# Pokémon Explorer

**PokeAPI → Worker → PostgreSQL (staging → tablas) → API → Web**

Pokédex full-stack: un worker baja los Pokémon de la PokeAPI, genera los datos sintéticos, los valida y los carga en PostgreSQL, y una web en React los muestra a través de una API propia en NestJS. Las corridas del worker se encolan en Redis (BullMQ).

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Redux Toolkit](https://img.shields.io/badge/Redux_Toolkit-2-764ABC?logo=redux&logoColor=white)
![MUI](https://img.shields.io/badge/MUI-9-007FFF?logo=mui&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-8-DC382D?logo=redis&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker_Compose-v2-2496ED?logo=docker&logoColor=white)

| 🚀 [Cómo correrlo](#-cómo-correrlo) | ⚙️ [El worker](#️-el-worker) | 🐘 [Esquema de la base](#-esquema-de-la-base) | 🧩 [Arquitectura](#-arquitectura) |
| :---------------------------------: | :-------------------------: | :-------------------------------------------: | :-------------------------------: |

</div>

## 🚀 Cómo correrlo

**Requisitos:** Docker con Compose v2, Node 24 (`nvm use`, ver `.nvmrc`) y pnpm 10 (`corepack enable`).

```sh
cp .env.example .env           # 1. variables: puertos, usuarios y claves
docker compose up -d --build   # 2. Postgres, Redis, migraciones, worker, API y web
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
| Redis 8       | `localhost:6411`                 | sin clave               |

```sh
docker compose logs -f worker   # qué hace el worker, paso a paso
docker compose down             # detiene todo; los datos quedan en los volúmenes
docker compose down -v          # detiene y borra los datos (Postgres y Redis)
```

### Modo desarrollo

La API, el worker y la web corren fuera de Docker, con recarga en caliente; Docker levanta solo Postgres y Redis:

```sh
pnpm install
docker compose -f docker-compose.base.yml up -d   # Postgres, Redis y migraciones
pnpm dev                                          # web en http://localhost:4200, API en http://localhost:3000/api y el worker
```

| Archivo                   | Levanta                                                             | Para qué                         |
| ------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| `docker-compose.yml`      | `docker-compose.base.yml` + `api`, `worker` y `web` en contenedores | Correr todo: `docker compose up` |
| `docker-compose.base.yml` | `postgres`, `redis` y `migrate` (Prisma)                            | Desarrollar con `pnpm dev`       |

Los dos son el mismo proyecto de compose (`pokemon-worker-ts`), así que comparten contenedores y volúmenes: lo que cargue el worker se ve en los dos modos. La web en Docker usa el puerto 8011 y `pnpm dev` el 4200 y el 3000, así que pueden estar arriba a la vez. Con los dos modos arriba habría dos workers sobre la misma cola: no es un problema (BullMQ entrega cada corrida a un solo worker y el lock evita que se pisen), pero lo normal es usar uno.

<details>
<summary><b>Detalles de Docker</b></summary>

- Ambos archivos leen el `.env` de la raíz (plantilla: `.env.example`); si falta una variable, compose no arranca. `WEB_PORT` y `API_CORS_ALLOW_ORIGINS` solo los usa `docker-compose.yml` (la API en producción no acepta `*`).
- `api` (`apps/api/Dockerfile`), `worker` (`apps/worker/Dockerfile`) y `web` (`apps/pokemon/Dockerfile`) son imágenes de producción: después de cambiar código, `docker compose up -d --build` las reconstruye. La API no publica puerto: se llega por la web en `/api`.
- Las imágenes de la API y del worker traen su `dist` (Nest CLI) más el TypeScript de `context/`, `libs/` y `db/main`, que Node ejecuta quitando los tipos (no lo hace dentro de `node_modules`), así que conservan la estructura del workspace. Corren como `node`.
- `redis` usa `--appendonly yes` y el volumen `redis-data`: las corridas encoladas y su estado sobreviven a un reinicio de Redis. `api` y `worker` esperan a que esté sano (`redis-cli ping`) y reciben `REDIS_URL=redis://redis:6379`.
- El servicio `worker` usa `stop_grace_period: 20s`: al apagarse espera hasta 10 s al paso en curso y Docker no debe matarlo antes.
- No se monta ningún volumen de datos: el stack no escribe archivos en el host.
- `migrate` aplica las migraciones de Prisma, incluido el schema `staging`. Usuario, clave y base de Postgres se crean junto con el volumen: para cambiarlos después, `docker compose down -v`.
- El `DATABASE_URL` de `db/main/.env.example`, `apps/api/.env.example` y `apps/worker/.env.example` apunta a este Postgres, y su `REDIS_URL` a este Redis: si cambias el `.env` de la raíz, actualízalos también.

</details>

## ⚙️ El worker

`apps/worker` es una app de NestJS sin servidor HTTP que consume la cola `etl` (BullMQ sobre Redis), toma una corrida y ejecuta todo el pipeline. La API solo **encola** (`POST /api/etl/runs`) y consulta el estado; no ejecuta nada. La lógica está en `context/ingestion` (casos de uso, puertos y adapters); la generación de datos y el cliente de la PokeAPI, en `libs/pokemon-data`.

```mermaid
flowchart LR
  pokeapi(["🌐 PokeAPI"]) --> scrape["🌐 scrape<br/>pokemon, types,<br/>pokemon_types"]
  scrape --> generate["🎲 generate<br/>trainers, captures,<br/>battles"]
  generate --> validate["✅ validate<br/>revisa las 6 tablas<br/>de staging"]
  validate --> load["📦 load<br/>TRUNCATE + INSERT<br/>en una transacción"]
  load --> views["🔎 build_views<br/>crea o actualiza<br/>las vistas"]
  scrape -.-> staging[("🗂️ schema staging")]
  generate -.-> staging
  staging -.-> validate
  staging -.-> load
  load --> db[("🐘 tablas públicas")]
  views --> db

  classDef task fill:#e7f5ff,stroke:#1c7ed6,color:#0b3d6b
  classDef store fill:#f3f0ff,stroke:#7048e8,color:#2e1a6b
  classDef ext fill:#fff4e6,stroke:#f08c00,color:#5c3a00
  class scrape,generate,validate,load,views task
  class staging,db store
  class pokeapi ext
```

Entre pasos, los datos viven en las tablas del schema `staging` de Postgres (sin PK, FK ni CHECK a propósito: así `validate` puede informar todos los problemas juntos en vez de fallar al insertar).

1. **`scrape`** baja los Pokémon `1..POKEMON_LIMIT` de la PokeAPI (8 requests a la vez, timeout de 15 s y hasta 4 intentos con espera creciente ante errores de red, 429 y 5xx; respeta `Retry-After`) y, en una transacción, vacía y llena `staging.types`, `staging.pokemon` y `staging.pokemon_types` (`sprites.front_default` va a `sprite_url`). Cualquier otro error HTTP corta el paso.
2. **`generate`** lee los ids de `staging.pokemon` y llena `staging.trainers`, `staging.captures` y `staging.battles` (50 entrenadores, 5.000 capturas y 2.000 batallas en 12 meses). Es un port exacto del generador Python del desafío: misma semilla (42), mismo generador de números aleatorios de CPython y mismas filas. Necesita al menos 2 Pokémon en staging.
3. **`validate`** lee las 6 tablas de staging y las valida. La corrida falla, sin tocar las tablas finales, si:
   - una tabla está vacía;
   - un valor requerido es NULL o un texto está en blanco;
   - se repite un id o una clave única;
   - una referencia apunta a un id que no existe (`pokemon_id` y `trainer_id` de `captures`, y las demás FK);
   - una fila de `types`, `pokemon`, `pokemon_types` o `trainers` rompe una regla de la base.

   En `captures` y `battles`, que ninguna tabla referencia, una fila que rompe una regla se descarta y queda en el log y en el `output` del paso (el generador produce algunas batallas con duración negativa: 4 de 2.000, por eso se cargan 1.996). Un `base_experience` NULL se carga como 0, el default de la columna.

4. **`load`** vuelve a leer y validar staging (lo que se carga es exactamente lo validado), vacía las 6 tablas finales y las llena con `INSERT … SELECT` desde staging, en orden de FK y en una sola transacción. Es **idempotente**: otra corrida deja exactamente los mismos datos, y si algo falla la base queda como estaba.
5. **`build_views`** crea o actualiza las vistas con `db/main/sql/views.sql`.

Los pasos que escriben (`scrape`, `generate` y `load`) confirman su transacción solo si la ejecución sigue siendo dueña de la corrida (el cerco, abajo). Staging no lo comparten dos corridas: hay una sola activa a la vez.

### La cola (BullMQ)

Las corridas viven en Redis: cola `etl`, un job `pokemon-etl` por corrida, con el `runId` como id del job. No hay tablas de cola en Postgres.

- **Una sola corrida activa.** `POST /api/etl/runs` encola con `deduplication: { id: 'pokemon-etl' }` y la cola tiene concurrencia global 1 (el worker también, `concurrency: 1`). Si ya hay una corrida en cola, corriendo o esperando un reintento, la respuesta es esa misma (mismo `runId`): dos POST simultáneos devuelven la misma corrida. `enqueue` y `retry` además se ordenan con un candado corto en Redis, y buscan antes la corrida activa: la deduplicación sola no cubre el hueco de un reintento manual (el job vuelve de `failed` sin recuperar la clave).
- **Reintentos con backoff.** `attempts: 3` con backoff exponencial desde 5 s (5 s, 10 s). Se conservan los últimos 100 jobs terminados y los últimos 100 fallidos.
- **Errores.** Un error **permanente** (datos inválidos, HTTP 4xx salvo 429, URL de tipo inesperada, violaciones de restricciones de la base) se lanza como `UnrecoverableError`: BullMQ no lo reintenta y la corrida queda `failed` de inmediato. Uno **reintentable** (red, timeouts, plazos, conexión, HTTP 429 o 5xx, intentos agotados contra la PokeAPI) se lanza como `Error` y BullMQ reintenta con el backoff. La clasificación es por **tipo** de error (errores tipados de `libs/pokemon-data` y del contexto, y el SQLSTATE de Postgres), nunca por el texto del mensaje. El motivo (`failedReason` y el `error` de la corrida) es `<paso>: <error>` seguido de una línea `causa:` por cada causa encadenada.
- **Progreso y retomar.** El estado de los 5 pasos se guarda en el progreso del job (`job.updateProgress({ steps })`) en cada transición. Cada ejecución (reintento, recuperación tras una caída o reintento manual) lo lee y salta los pasos `succeeded`: sus datos ya están en staging.
- **Recuperación tras una caída (stalled).** El worker renueva el lock del job en Redis mientras vive (`lockDuration` 30 s, `LOCK_DURATION_MS`). Si el proceso muere (kill, caída de la máquina), el lock vence y el chequeo de jobs estancados de BullMQ (`stalledInterval` 30 s, `maxStalledCount: 1`) devuelve el job a la cola; otro worker, o el mismo al reiniciar, retoma desde el paso interrumpido. Tarda entre uno y dos intervalos más el `lockDuration`, es decir, del orden de un minuto con los valores por defecto. Una corrida que se queda estancada más de una vez falla.
- **Cerco.** Antes de confirmar cada transacción de escritura, el paso llama a `job.extendLock(token, lockDuration)`, que comprueba y renueva el lock de forma atómica: si ya no es de esta ejecución (venció o lo tiene otro worker), lanza `FenceLostError`, la transacción se revierte y la ejecución se detiene sin escribir. Un paso «zombi» no puede pisar los datos que usa otro worker.
- **Reintento manual.** `POST /api/etl/runs/:runId/retry` vuelve a encolar una corrida `failed` con `job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true })` conservando el progreso: retoma desde el paso que falló, no desde cero. `404` si no existe; `409` si no está fallida o si ya hay otra corrida en curso. **Carrera «reintento vs POST nuevo»:** se ordenan con el candado de Redis, así que nunca quedan dos corridas activas: si gana el reintento, el POST devuelve esa corrida; si gana el POST, el reintento recibe `409 Ya hay una corrida en curso`. Típico: falla `validate` por un dato malo, lo corriges en `staging` y reintentas.
- **Apagado (drain/abandon).** Con SIGINT/SIGTERM (`app.enableShutdownHooks()`), el worker deja de tomar corridas, termina el paso en curso y no empieza el siguiente (**drain**); si ese paso tarda más de 10 s, lo cancela (**abandon**: se aborta su `AbortSignal` y, gracias al cerco, no confirma nada; si una sentencia bloqueada en Postgres no responde a la cancelación, se espera a lo sumo 3 s más y el proceso sale igual, y Postgres deshace la transacción al cerrarse la conexión). El proceso sale con código 0. En ambos casos la corrida vuelve a la cola sin gastar un intento y otro arranque la retoma desde ese paso. Compose usa `stop_grace_period: 20s` para que Docker no lo mate antes. Si el proceso sí muere de golpe, se recupera por el chequeo de jobs estancados.
- **Plazos.** Cada paso tiene un plazo total de 5 minutos y las sentencias a Postgres un `statement_timeout` de 60 s; vencido cualquiera, el error es reintentable. Cada paso recibe un `AbortSignal` que llega hasta los requests HTTP, las transacciones y la conexión de las vistas: un paso vencido se cancela de verdad y se espera a que termine antes de seguir (el abandonado por el apagado, con el tope de 3 s de arriba).
- **Si algo se cae.**
  - **Redis:** no se puede encolar ni consultar corridas desde la API (el `POST` y el `GET` de `/api/etl/runs` fallan o quedan esperando hasta que Redis vuelva), y el worker no recibe corridas; ambos reconectan solos cuando vuelve. Lo ya guardado se conserva (`appendonly`). El resto de la API (Pokémon y reportes) no usa Redis y sigue respondiendo.
  - **Postgres:** el paso en curso falla como reintentable (3 intentos con backoff); si se agotan, la corrida queda `failed` y se retoma con `retry` cuando Postgres vuelva. Un error de infraestructura al guardar el progreso no es un fallo del paso: se propaga y BullMQ trata el intento como fallido.
  - **El worker:** ver «Recuperación tras una caída». Mientras tanto la corrida figura `running`.

### Variables del worker

Se validan al arrancar con Zod (`apps/worker/src/config/env.ts`, vía `ConfigModule`); si alguna es inválida, el worker no arranca. Plantilla: `apps/worker/.env.example`.

| Variable           | Default                                                 | Qué es                                                                        |
| ------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`     | `postgresql://postgres:postgres@localhost:5441/pokemon` | Base de la app (tablas finales y staging)                                     |
| `REDIS_URL`        | `redis://localhost:6411`                                | Redis de la cola de corridas                                                  |
| `POKEAPI_URL`      | `https://pokeapi.co/api/v2`                             | Base de la PokeAPI                                                            |
| `POKEMON_LIMIT`    | `100`                                                   | Pokémon `1..n` que baja `scrape` (2 a 1025)                                   |
| `LOCK_DURATION_MS` | `30000`                                                 | Duración del lock de la corrida en Redis (mín. 1000); solo se baja en pruebas |

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

El estado de la corrida (`state`) sale del job: en cola o esperando un reintento → `queued`, activo → `running`, terminado → `succeeded`, fallido → `failed`. `attempts` son las ejecuciones **empezadas** (cuenta también las retomas tras una caída o un apagado) y `error`, el último `failedReason` (se conserva mientras el reintento espera su backoff).

Para mirar la cola directamente en Redis (con compose: `docker compose exec redis redis-cli`; el prefijo por defecto de BullMQ es `bull`):

```sh
redis-cli -p 6411 KEYS 'bull:etl:*'                       # claves de la cola
redis-cli -p 6411 HGETALL bull:etl:<runId>                # el job: timestamp, attemptsStarted, failedReason, progress…
redis-cli -p 6411 LRANGE bull:etl:wait 0 -1               # corridas en espera
redis-cli -p 6411 LRANGE bull:etl:active 0 -1             # la corrida activa
redis-cli -p 6411 ZRANGE bull:etl:failed 0 -1             # corridas fallidas
redis-cli -p 6411 ZRANGE bull:etl:delayed 0 -1 WITHSCORES # esperando backoff (el score es la hora de reintento)
```

Y para ver lo que dejó cada paso en staging (los datos entre pasos; tras un `load` exitoso siguen ahí hasta la corrida siguiente):

```sh
docker compose exec postgres psql -U postgres pokemon -c 'SELECT count(*) FROM staging.pokemon'
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

Entre pasos, los datos pasan por el schema `staging` (migración `20261106000000_staging`, SQL plano que Prisma no modela): las mismas 6 tablas con las mismas columnas, **sin** PK, FK, CHECK ni NOT NULL, para que `validate` revise todo antes de que `load` toque las tablas finales. `scrape` escribe `types`, `pokemon` y `pokemon_types`; `generate`, `trainers`, `captures` y `battles`. El estado de las corridas no está en la base: vive en Redis (ver [La cola](#la-cola-bullmq)).

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
    worker["worker<br/>NestJS · BullMQ"]
    migrate["migrate<br/>migraciones Prisma"]
    redis[("🟥 Redis 8 · :6411<br/>cola etl")]
    subgraph pg["🐘 PostgreSQL 18 · :5441"]
      dbapp[("base pokemon<br/>tablas + vistas<br/>schema staging")]
    end
  end

  user -->|HTTP| web
  web -->|"proxy /api"| api
  api -->|"lee tablas y vistas"| dbapp
  api -->|"POST /etl/runs →<br/>encola · GET → estado"| redis
  redis -->|"entrega la corrida<br/>(un solo worker)"| worker
  worker -->|"progreso y lock<br/>(cerco) del job"| redis
  worker --> pokeapi
  worker -->|"staging → validate<br/>→ load + build_views"| dbapp
  migrate -->|"crea tablas,<br/>constraints y staging"| dbapp

  classDef ext fill:#fff4e6,stroke:#f08c00,color:#5c3a00
  classDef app fill:#e7f5ff,stroke:#1c7ed6,color:#0b3d6b
  classDef etl fill:#ebfbee,stroke:#2f9e44,color:#14532d
  classDef store fill:#f3f0ff,stroke:#7048e8,color:#2e1a6b
  class user,pokeapi ext
  class web,api app
  class worker,migrate etl
  class redis,dbapp store
```

- **Orden de arranque:** Postgres y Redis sanos → `migrate` aplica las migraciones de Prisma (tablas, constraints y schema `staging`) y termina → API, worker y web. El worker no crea tablas: solo carga datos y crea las vistas.
- **Dos almacenes:** Postgres (`pokemon`) guarda los datos (tablas finales y staging) y Redis, las corridas (estado, progreso y lock). La API lee Postgres y encola y consulta en Redis; el worker escribe en Postgres y consume Redis.
- **Una sola definición de las vistas:** `db/main/sql/views.sql`. El worker las crea con ese archivo (`db/main` lo exporta como `viewsSqlPath`) y la API las lee; un test de contrato en `context/pokedex` verifica que ambos lados calcen.
- **Web** (`apps/pokemon`): SPA de Vite con React Router (`/items`, `/item/:id` y `/reports/*`), estado y caché de respuestas en Redux Toolkit, UI con MUI. Habla con la API solo por HTTP en `/api` (en Docker, nginx la reenvía; en dev, el proxy de Vite a `:3000`).
- **API** (`apps/api`): NestJS. Lee la base con los repositorios de `context/pokedex` y encola y consulta corridas con los casos de uso de `context/ingestion` sobre BullMQ; no ejecuta el pipeline.
- **Worker** (`apps/worker`): app de Nest sin HTTP. `modules/etl` arma los casos de uso de `context/ingestion` con sus adapters y `EtlProcessor` (`@nestjs/bullmq`) ejecuta cada corrida.

### Código (monorepo Nx con pnpm)

```mermaid
flowchart LR
  web["apps/pokemon<br/>React · RTK · MUI"]
  api["apps/api<br/>NestJS"]
  worker["apps/worker<br/>NestJS · BullMQ"]
  subgraph ctx["contexts · hexagonales"]
    direction LR
    pokedex["context/pokedex<br/>catálogo y reportes"]
    ingestion["context/ingestion<br/>pipeline y cola"]
  end
  lib["libs/pokemon-data<br/>PokeAPI y generador"]
  db["db/main<br/>Prisma: schema,<br/>migraciones y cliente"]

  web -.->|"solo tipos"| pokedex
  api --> pokedex
  api --> ingestion
  worker --> ingestion
  pokedex --> db
  ingestion --> db
  ingestion --> lib

  classDef app fill:#e7f5ff,stroke:#1c7ed6,color:#0b3d6b
  classDef core fill:#ebfbee,stroke:#2f9e44,color:#14532d
  classDef store fill:#f3f0ff,stroke:#7048e8,color:#2e1a6b
  class web,api,worker app
  class pokedex,ingestion,lib core
  class db store
```

| Proyecto                     | Ruta                | Qué es                                                                                     |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| `@pokemon/pokemon`           | `apps/pokemon`      | Web (SPA): React 19 · Vite 8 · React Router 8 · Redux Toolkit · MUI 9                      |
| `@pokemon/api`               | `apps/api`          | API: NestJS 12 (ESM) · Zod · `@nestjs/bullmq` (solo encola y consulta)                     |
| `@pokemon/worker`            | `apps/worker`       | Worker: NestJS 12 (ESM) · `@nestjs/bullmq`, procesa la cola `etl`                          |
| `@pokemon/pokemon-e2e`       | `apps/pokemon-e2e`  | Tests e2e (Playwright)                                                                     |
| `@pokemon/context-pokedex`   | `context/pokedex`   | Catálogo y reportes, solo lectura ([README](context/pokedex/README.md))                    |
| `@pokemon/context-ingestion` | `context/ingestion` | Pipeline, validación de staging y cola de corridas ([README](context/ingestion/README.md)) |
| `@pokemon/pokemon-data`      | `libs/pokemon-data` | Cliente de la PokeAPI y generador sintético (port de CPython)                              |
| `@pokemon/db-main`           | `db/main`           | Prisma 7 + PostgreSQL ([README](db/main/README.md))                                        |

- **app** (`apps/`):
  - `pokemon` (web): estado en Redux Toolkit (`src/app/store.ts`, un slice por feature en `src/features/`), rutas en `src/routes.tsx`. De `context/pokedex` importa solo tipos (no entran al bundle), así web y API comparten el contrato.
  - `api`: es quien arma los casos de uso de un context con sus adapters, un módulo por área en `src/modules/`. Prefijo global `/api`. El entorno se valida con Zod al arrancar (`src/config/env.ts`, variables en `apps/api/.env.example`); si no cumple, no arranca. El input de una ruta se valida con un schema de Zod: `@Query({ schema })`, `@Body({ schema })` (pipe global `StandardSchemaValidationPipe`).
  - `worker`: misma estructura que la API. `src/main.ts` crea el contexto de Nest (sin HTTP) y activa los shutdown hooks; `src/config/` valida el entorno; `src/modules/database` abre Prisma; `src/modules/etl` arma los pasos y registra el `EtlProcessor`.
- **context** (`context/<nombre>`): `domain` → `application` (ports y casos de uso) → `infra/adapters` (Repository Pattern sobre Prisma, `pg` y BullMQ). Un context no importa a otro.
- **db** (`db/<nombre>`): schema, migraciones y cliente de Prisma.
- **lib** (`libs/`): código compartido y sin dependencias de infraestructura.
- Los tests de cada proyecto van en `tests/`, espejo de `src/`.

Los límites los aplica `@nx/enforce-module-boundaries` (`eslint.config.mjs`) según los tags `type:` (`app`, `e2e`, `context`, `db`, `lib`) de `nx.tags` en el `package.json` de cada proyecto. Un proyecto sin tags no puede importar nada.

### Estructura y equivalencias

Cada carpeta del proyecto principal conserva su nombre y sus carpetas internas aquí, con un archivo por tipo, caso de uso, puerto, adaptador y módulo. Las piezas nuevas siguen a su hermana más cercana: el worker replica la estructura de `apps/api` y `context/ingestion` la de `context/pokedex`.

| Proyecto principal                                                                               | Aquí                                                                                            | Nota                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/{main,app.module,app.setup}.ts`                                                    | igual                                                                                           | `app.module.ts` suma `BullModule.forRootAsync` (`REDIS_URL`)                                                                                                                                                                         |
| `apps/api/src/config/{env,index}.ts`                                                             | igual                                                                                           | `env.ts` suma `REDIS_URL` (default `redis://localhost:6411`)                                                                                                                                                                         |
| `apps/api/src/common/{filters/api-exception.filter,helpers/nest-provider.helper}.ts`             | igual                                                                                           |                                                                                                                                                                                                                                      |
| `apps/api/src/modules/{database,health,items,reports,pokedex}/*`                                 | igual                                                                                           |                                                                                                                                                                                                                                      |
| `apps/api/src/modules/etl/{etl.controller,etl.module}.ts`                                        | igual                                                                                           | `etl.module.ts` registra la cola `etl` y arma `EnqueueEtlRun`, `GetEtlRun` y `RetryEtlRun` con `BullMqEtlRunQueue`                                                                                                                   |
| `apps/api/src/modules/etl/airflow.client.ts` y `tests/modules/etl/airflow.client.spec.ts`        | (no existe)                                                                                     | La API encola en BullMQ, no llama a Airflow                                                                                                                                                                                          |
| `apps/api/tests/{config/env.spec.ts,helpers.ts,modules/<área>/*.spec.ts}`                        | igual                                                                                           | Suma `modules/etl/etl.module.spec.ts`                                                                                                                                                                                                |
| `apps/pokemon`, `apps/pokemon-e2e`                                                               | igual                                                                                           | Sin cambios (React + Playwright)                                                                                                                                                                                                     |
| (sin equivalente: lo hace Airflow)                                                               | `apps/worker/src/{main,app.module}.ts`                                                          | `main.ts`: `NestFactory.createApplicationContext` + `enableShutdownHooks` (con `useProcessExit`: sale con código 0)                                                                                                                  |
| (sin equivalente)                                                                                | `apps/worker/src/config/{env,index}.ts`                                                         | Zod con el mismo `ConfigModule` que la API: `DATABASE_URL`, `REDIS_URL`, `POKEAPI_URL`, `POKEMON_LIMIT`, `LOCK_DURATION_MS`                                                                                                          |
| (sin equivalente)                                                                                | `apps/worker/src/common/helpers/nest-provider.helper.ts`, `modules/database/database.module.ts` | Copia de los de la API (`provideUseCase`, Prisma)                                                                                                                                                                                    |
| (sin equivalente)                                                                                | `apps/worker/src/modules/etl/{etl.module,etl.processor}.ts`                                     | `etl.module.ts` conecta adapters y casos de uso; `etl.processor.ts` es el `@Processor('etl')` sobre `WorkerHost`                                                                                                                     |
| (sin equivalente)                                                                                | `apps/worker/tests/{config/env.spec.ts,modules/etl/etl.processor.spec.ts}`                      |                                                                                                                                                                                                                                      |
| `context/pokedex/src/domain/{entities,reports}/*`                                                | igual (en `context/pokedex`)                                                                    |                                                                                                                                                                                                                                      |
| `context/pokedex/src/application/{errors.ts,ports/*,use-cases/*}`, `infra/adapters/*`, `tests/*` | igual (en `context/pokedex`)                                                                    |                                                                                                                                                                                                                                      |
| (sin equivalente)                                                                                | `context/ingestion/src/domain/{dataset,run,errors.ts}`                                          | `dataset/`: forma de las 6 tablas y `validateStaging`; `run/`: `EtlRun` y sus pasos; `errors.ts`: errores tipados y su clasificación                                                                                                 |
| (sin equivalente)                                                                                | `context/ingestion/src/application/{errors.ts,ports/*,use-cases/*}`                             | Puertos: `RunQueue`, `RunProgress`, `RunFence`, `StepContext`, `PokemonSource`, `StagingStore`, `DatasetLoader`, `ViewsBuilder`, `Logger`. Casos de uso: uno por paso, `EnqueueEtlRun`, `GetEtlRun`, `RetryEtlRun` y `ExecuteEtlRun` |
| (sin equivalente)                                                                                | `context/ingestion/src/infra/adapters/*`                                                        | `PokeApiPokemonSource`, `PrismaStagingStore`, `PrismaDatasetLoader`, `PgViewsBuilder`, `BullMqEtlRunQueue`, `BullMqRunProgress`, `BullMqRunFence`                                                                                    |
| (sin equivalente)                                                                                | `context/ingestion/tests/{domain,application/use-cases,infra/adapters}/*`                       | Los de `infra/` usan Postgres y Redis reales                                                                                                                                                                                         |
| `db/main/{index.ts,prisma/,sql/views.sql}`                                                       | igual                                                                                           | La migración `20261106000000_staging` suma el schema `staging` (SQL plano)                                                                                                                                                           |
| `scripts/generate_pokemon_data.py`                                                               | `libs/pokemon-data/src/{rng,generator}.ts`                                                      | Port exacto del generador; `pokeapi.ts` es el cliente de la PokeAPI y `errors.ts` los errores tipados                                                                                                                                |
| `platform/airflow`                                                                               | `apps/worker` + `context/ingestion`                                                             | El DAG pasa a ser el pipeline del worker                                                                                                                                                                                             |
| `platform/ops`                                                                                   | (eliminada)                                                                                     | Su único trabajo era producir los CSV                                                                                                                                                                                                |
| `data/`                                                                                          | (eliminada)                                                                                     | No hay CSV: los datos pasan por las tablas `staging`                                                                                                                                                                                 |
| `docker-compose*.yml`                                                                            | igual                                                                                           | Suman `redis` y `REDIS_URL`                                                                                                                                                                                                          |

### Diferencias con la alternativa Rust

Las dos alternativas tienen el mismo pipeline (`scrape → generate → validate → load → build_views` sobre tablas `staging`), los mismos mensajes de validación, el mismo contrato HTTP y los mismos datos resultantes. Cambia la cola y, con ella, el lenguaje del backend:

- **TS (esta):** BullMQ sobre Redis (`@nestjs/bullmq`): deduplicación para una sola corrida activa, reintentos con backoff de BullMQ, `UnrecoverableError` para los fallos permanentes, el progreso de los pasos en el job y el lock del job como cerco. Postgres solo guarda los datos.
- **Rust (`../worker-rust`):** las corridas viven en tablas de Postgres (`etl_runs`, `etl_run_steps`) con un índice único parcial, `LISTEN/NOTIFY`, claim con `SKIP LOCKED`, lease con heartbeat y token de fencing. No usa Redis.
- Por eso `context/ingestion` tiene aquí `RunQueue`, `RunProgress` y `RunFence` sobre BullMQ y allá una cola y un notificador sobre Postgres, y este compose suma el servicio `redis`.

## 🔌 API

`apps/api`, prefijo `/api` (en Docker, `http://localhost:8011/api`; con `pnpm dev`, `http://localhost:3000/api`). Lee la base `pokemon` (`DATABASE_URL`) y encola y consulta corridas en Redis (`REDIS_URL`, default `redis://localhost:6411`).

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

| Caso                                                                     | Código |
| ------------------------------------------------------------------------ | :----: |
| Entrada inválida (incl. un `runId` que no es UUID)                       | `400`  |
| Id o corrida inexistente                                                 | `404`  |
| Reintentar una corrida que no está fallida, o con otra ya en curso       | `409`  |
| Datos aún no disponibles (la vista no existe)                            | `503`  |
| No se pudo encolar (candado de la cola no obtenido en 5 s) o Redis caído | `500`  |

## 🔧 Desarrollo

```sh
pnpm install
pnpm dev          # web en http://localhost:4200, API en http://localhost:3000/api y el worker (con docker-compose.base.yml arriba)
pnpm build        # build de todos los proyectos
pnpm test         # tests unitarios (Vitest)
pnpm lint
pnpm typecheck
pnpm e2e          # Playwright (chromium, firefox, webkit)
```

- Para un proyecto o target puntual: `pnpm nx run <proyecto>:<target>`. Lista de targets: `pnpm nx show project <proyecto>`.
- La primera vez en una máquina, para el e2e: `pnpm exec playwright install --with-deps` (descarga los navegadores e instala sus librerías de sistema; pide sudo).
- **Tests con Postgres y Redis:** los de `context/ingestion/tests/infra` (cola de BullMQ, cerco, staging, loader, vistas) y el contrato de `context/pokedex` necesitan un Postgres (`TEST_DATABASE_URL`) y, los de la cola, un Redis (`TEST_REDIS_URL`); sin ellas se saltan. Cada archivo con Postgres crea sus propios schemas (tablas finales y staging) y los borra al terminar; cada prueba de la cola usa un prefijo de Redis propio y lo borra. Incluyen la recuperación tras matar con SIGKILL a un worker en otro proceso:

  ```sh
  docker run -d --rm --name pokemon-test-pg -e POSTGRES_PASSWORD=postgres -p 55441:5432 postgres:18-alpine
  docker run -d --rm --name pokemon-test-redis -p 56411:6379 redis:8-alpine
  TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55441/postgres \
  TEST_REDIS_URL=redis://localhost:56411 pnpm test
  docker stop pokemon-test-pg pokemon-test-redis
  ```

- Cambios en `db/main/prisma/schema.prisma`: `pnpm nx run @pokemon/db-main:generate` regenera el cliente. El schema `staging` vive solo en el SQL de su migración (Prisma no lo modela); `prisma migrate diff` debe seguir sin diferencias.

<details>
<summary><b>Notas</b></summary>

- Nuevo context: `pnpm nx g @nx/js:lib context/<nombre> --name=@pokemon/context-<nombre> --bundler=none --unitTestRunner=vitest --linter=eslint --tags=type:context,scope:<nombre>`; para consumirlo, agrégalo con `workspace:*` al `package.json` de quien lo use y corre `pnpm nx sync`.
- Los targets los infieren los plugins de `nx.json`. Declarados a mano: `generate` (cliente de Prisma, antes de `build`, `dev`, `test` y `typecheck` de quien dependa de `db`) y, en la API y el worker, `build`/`dev`/`start` (scripts de su `package.json`; Nest CLI compila con `tsc` a `apps/<app>/dist`).
- Los contexts y `libs/` no se compilan: Node 24 ejecuta su TypeScript quitando los tipos, así que solo usan sintaxis borrable (sin enums ni parameter properties) e `import type`. Las apps sí se compilan con Nest CLI (usan decoradores).
- La API y el worker son ESM, como el resto: imports relativos con `.ts`, que `tsc` reescribe a `.js` (`rewriteRelativeImportExtensions`). Vitest (Oxc) emite la metadata de los decoradores, así que la inyección por tipo funciona en los tests sin SWC.
- `bullmq` 6 solo carga `ioredis` si está instalado (peer opcional): por eso `ioredis` es dependencia explícita de `context/ingestion`, la API y el worker.
- Nx, TypeScript, ESLint y Vitest se actualizan con `pnpm nx migrate latest`, para no adelantarse a lo que soportan los plugins de Nx. `prisma` va fijo a `^7`: en npm, `latest` apunta a un release candidate de la 8.

</details>
