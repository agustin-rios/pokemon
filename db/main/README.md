# @pokemon/db-main

Prisma 7 sobre PostgreSQL: schema (`prisma/schema.prisma`), migraciones (`prisma/migrations`) y cliente generado en `generated/` (no se versiona ni se edita). El único código propio es `index.ts`.

Exporta el cliente generado y `createPrismaClient(url)`.

Objetos de la base:

- **Tablas y constraints**: las migraciones de Prisma (`prisma/migrations`), que aplica el servicio `migrate` de docker compose.
- **Vistas de las consultas**: `sql/views.sql`, fuente única. Lo ejecuta el DAG (`build_views`; se monta en Airflow) y lo lee el contexto pokedex, cuyo test de contrato aplica este mismo archivo.

```sh
cp db/main/.env.example db/main/.env   # DATABASE_URL
pnpm --filter @pokemon/db-main generate        # también lo corren build/dev/test/typecheck
pnpm --filter @pokemon/db-main migrate:dev
pnpm --filter @pokemon/db-main migrate:deploy
pnpm --filter @pokemon/db-main studio
```

`generate` no necesita `DATABASE_URL`; `migrate` y `studio`, sí.
