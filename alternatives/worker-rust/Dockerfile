# Imágenes del backend en Rust (contexto: la raíz del repo, con su .dockerignore).
# Targets: `api`, `worker` y `migrate`; los usa docker-compose.yml.
#   docker build --target api -t pokemon-api .
FROM rust:1.99-bookworm AS build
WORKDIR /repo
COPY . .
# Los tres binarios salen de un solo build; target/ vive en el cache mount, así que se
# copian a /out dentro del mismo RUN.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/repo/target \
    cargo build --release --locked -p pokemon-api -p pokemon-worker -p pokemon-db \
    && mkdir -p /out \
    && cp target/release/pokemon-api target/release/pokemon-worker target/release/migrate /out/


FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -u 1000 -m app
USER app
ENV APP_ENV=production


FROM runtime AS api
COPY --from=build /out/pokemon-api /usr/local/bin/pokemon-api
ENV PORT=3000
EXPOSE 3000
CMD ["pokemon-api"]


FROM runtime AS worker
COPY --from=build /out/pokemon-worker /usr/local/bin/pokemon-worker
CMD ["pokemon-worker"]


# Aplica las migraciones y termina. Idempotente.
FROM runtime AS migrate
COPY --from=build /out/migrate /usr/local/bin/migrate
CMD ["migrate"]
