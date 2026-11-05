# Imagen de producción de la API (NestJS). La usa el servicio `api` de
# docker-compose.prod.yml. Contexto de build: la raíz del repo (usa su .dockerignore).
#
# Node ejecuta el context y db/main como TypeScript (quita los tipos) y no lo hace
# dentro de node_modules. Por eso la imagen final conserva la estructura del
# workspace: los paquetes @pokemon/* son symlinks de pnpm a su carpeta real.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Build: todas las dependencias, cliente de Prisma, typecheck y nest build (con Nx).
FROM base AS build
ENV NX_DAEMON=false
# package.json fija la versión de pnpm (packageManager) que usa corepack.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm nx run @pokemon/api:build

# Runtime: solo las dependencias de producción de la API y de sus paquetes del workspace.
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY context/pokedex/package.json context/pokedex/
COPY db/main/package.json db/main/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --filter "@pokemon/api..."
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/context/pokedex/src context/pokedex/src
COPY --from=build /repo/db/main/index.ts db/main/
COPY --from=build /repo/db/main/generated db/main/generated

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
