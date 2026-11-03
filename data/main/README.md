# @pokemon/data-main

Prisma 7 sobre PostgreSQL: schema (`prisma/schema.prisma`), migraciones (`prisma/migrations`) y cliente generado en `generated/` (no se versiona ni se edita). El único código propio es `index.ts`.

Exporta el cliente generado y `createPrismaClient(url)`.

```sh
cp data/main/.env.example data/main/.env   # DATABASE_URL
pnpm --filter @pokemon/data-main generate        # también lo corren build/dev/test/typecheck
pnpm --filter @pokemon/data-main migrate:dev
pnpm --filter @pokemon/data-main migrate:deploy
pnpm --filter @pokemon/data-main studio
```

`generate` no necesita `DATABASE_URL`; `migrate` y `studio`, sí.
