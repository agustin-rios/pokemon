# Alternativas

Dos versiones del proyecto que reemplazan **Apache Airflow** por un **worker** que hace todo el
pipeline: baja los Pokémon de la PokeAPI, genera los datos sintéticos, los valida y los carga en
PostgreSQL. Cada una es un **monorepo autónomo** (su propio pnpm, Nx, compose y README): no depende
del proyecto principal y las herramientas de la raíz no la ven (`.nxignore`, `vitest.config.mts`,
`.dockerignore`). **Sus comandos se corren desde su propia carpeta.**

| Alternativa                            | Qué cambia respecto del proyecto principal                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`worker-ts`](worker-ts/README.md)     | Worker en **NestJS** sobre **`@nestjs/bullmq` + Redis**. La API (Nest), la web y Prisma siguen igual.                                   |
| [`worker-rust`](worker-rust/README.md) | **Todo el backend en Rust** (axum, sqlx) con un worker sobre una **cola en una tabla de Postgres**. Solo la web y los e2e siguen en TS. |

## Lo que comparten

- **Pipeline sin archivos**: `scrape → generate → validate → load → build_views`. Los datos pasan de
  un paso al siguiente por tablas del schema `staging` (sin `data/` ni CSV); `load` copia de staging a
  las tablas finales en una sola transacción.
- **Retomar desde el paso que falló**: lo ya hecho queda en staging, así que un reintento, un worker
  caído o un retry manual no repiten los pasos terminados. Antes de cada commit el paso verifica que
  sigue siendo dueño de la corrida, para que un paso "zombie" no pise datos.
- **Una corrida activa a la vez**, reintentos con backoff para errores transitorios y fallo inmediato
  para los permanentes (por ejemplo, datos inválidos).
- **El mismo contrato HTTP** que el proyecto principal (`/api/items`, `/api/reports/*`) más
  `POST /api/etl/runs`, `GET /api/etl/runs/:id` y `POST /api/etl/runs/:id/retry`. La web es la misma.
- **Los mismos datos**: el generador es un port exacto del script en Python (mismo RNG), así que una
  corrida deja en la base exactamente lo mismo que el DAG de Airflow (verificado con un checksum de las
  seis tablas).
- **La misma organización de carpetas** que el proyecto principal; cada README tiene una tabla
  "Estructura y equivalencias".

## Diferencias entre las dos

|                          | `worker-ts`                                     | `worker-rust`                                                         |
| ------------------------ | ----------------------------------------------- | --------------------------------------------------------------------- |
| Cola                     | Redis + BullMQ (deduplicación, jobs estancados) | Tabla `etl_runs` en Postgres (`SKIP LOCKED`, leases, `LISTEN/NOTIFY`) |
| Estado de los pasos      | Progreso del job en Redis                       | Tabla `etl_run_steps`                                                 |
| Worker                   | App standalone de NestJS (`@Processor`)         | Binario de tokio                                                      |
| API                      | NestJS (igual que el proyecto principal)        | axum                                                                  |
| Base de datos            | Prisma (migraciones de Prisma)                  | sqlx (migraciones en `db/main/migrations`)                            |
| Servicios en compose     | postgres, redis, migrate, api, worker, web      | postgres, migrate, api, worker, web                                   |
| Puertos (`.env.example`) | web 8011 · Postgres 5441 · Redis 6411           | web 8021 · Postgres 5451                                              |

Los puertos y nombres de proyecto de compose (`pokemon-worker-ts`, `pokemon-worker-rust`) son distintos
de los del proyecto principal, así que se pueden levantar a la vez.

## Cómo probar una

```sh
cd alternatives/worker-ts        # o alternatives/worker-rust
cp .env.example .env
docker compose up -d --build
# web en http://localhost:8011 (TS) u 8021 (Rust) → «Cargar datos»
docker compose down -v           # al terminar
```

## Estado

**Pendiente de QA.** Cada alternativa pasó sus tests (unitarios e integración contra Postgres y Redis
reales) y una aceptación automatizada con Docker:

- **Datos y concurrencia:** checksum idéntico al de Airflow, segunda corrida igual y disparos
  simultáneos que devuelven la misma corrida.
- **Recuperación:** worker muerto a mitad de corrida que retoma solo el paso interrumpido, y apagado
  limpio.
- **Validación:** una corrida que falla en `validate` y retoma desde ahí después de corregir staging.
- **PokeAPI real:** una corrida contra la API de verdad.

No se probó:

- los e2e de Playwright;
- una caída de Redis en `worker-ts`;
- en `worker-ts`, el caso de terminar el paso y detenerse al apagar (está cubierto solo por tests
  unitarios; el abandono por timeout sí se probó en Docker).
