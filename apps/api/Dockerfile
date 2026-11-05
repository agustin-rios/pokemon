FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo


FROM base AS build
ENV NX_DAEMON=false

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prefer-offline --frozen-lockfile

RUN pnpm nx run @pokemon/api:build


FROM base AS runtime
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY context/pokedex/package.json context/pokedex/
COPY db/main/package.json db/main/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --no-optional --frozen-lockfile --filter "@pokemon/api..."

COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/context/pokedex/src context/pokedex/src
COPY --from=build /repo/db/main/index.ts db/main/
COPY --from=build /repo/db/main/generated db/main/generated

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
