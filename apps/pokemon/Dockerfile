# Imagen de producción de la web: la SPA de Vite servida con nginx, que además
# reenvía /api al servicio `api` (mismo origen, sin CORS). La usa el servicio `web`
# de docker-compose.prod.yml. Contexto de build: la raíz del repo (usa su .dockerignore).
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
ENV NX_DAEMON=false
# package.json fija la versión de pnpm (packageManager) que usa corepack.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm nx run @pokemon/pokemon:build

FROM nginx:1.30-alpine
COPY apps/pokemon/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/pokemon/dist /usr/share/nginx/html
