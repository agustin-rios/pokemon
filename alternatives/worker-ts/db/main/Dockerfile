# Imagen de una sola ejecución que aplica las migraciones de Prisma (tablas y
# constraints). La usa el servicio `migrate` de docker-compose.base.yml.
# Contexto de build: la raíz del repo (usa su .dockerignore).
FROM node:24-bookworm-slim

WORKDIR /migrate

# Mismas versiones que el monorepo (package.json raíz y db/main/package.json).
RUN npm install --no-save --no-audit --no-fund prisma@7.10.1 dotenv@17.4.2

COPY db/main/prisma.config.ts ./
COPY db/main/prisma/schema.prisma ./prisma/
COPY db/main/prisma/migrations ./prisma/migrations

# Solo aplica las migraciones pendientes: correrlo de nuevo no cambia nada.
CMD ["npx", "prisma", "migrate", "deploy"]
