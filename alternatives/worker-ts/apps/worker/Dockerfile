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

RUN pnpm nx run @pokemon/worker:build


FROM base AS runtime
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY context/ingestion/package.json context/ingestion/
COPY db/main/package.json db/main/
COPY libs/pokemon-data/package.json libs/pokemon-data/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --no-optional --frozen-lockfile --filter "@pokemon/worker..."

COPY --from=build /repo/apps/worker/dist apps/worker/dist
COPY --from=build /repo/context/ingestion/src context/ingestion/src
COPY --from=build /repo/libs/pokemon-data/src libs/pokemon-data/src
COPY --from=build /repo/db/main/index.ts db/main/
COPY --from=build /repo/db/main/generated db/main/generated
COPY --from=build /repo/db/main/sql db/main/sql

USER node
CMD ["node", "apps/worker/dist/main.js"]
