FROM oven/bun:1.4.2-debian AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.2-debian AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM debian:bookworm-slim AS runtime
ENV NODE_ENV=production COAST_DATA_DIR=/data HOST=0.0.0.0 PORT=3000 IDLE_TIMEOUT=60
RUN mkdir -p /etc/postgresql-common && printf 'create_main_cluster = false\n' > /etc/postgresql-common/createcluster.conf \
    && apt-get update && apt-get install -y --no-install-recommends postgresql postgresql-client ca-certificates tini gosu \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --user-group --create-home --home-dir /home/coast coast
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src/lib/server/db ./src/lib/server/db
COPY --from=build /app/src/lib/server/build-identity.ts ./src/lib/server/build-identity.ts
COPY --from=build /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=build /app/scripts/container-child-exit.ts ./scripts/container-child-exit.ts
COPY --from=build /app/scripts/container-application.ts ./scripts/container-application.ts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/LICENSE /app/NOTICE.md /app/THIRD_PARTY_NOTICES.md ./
COPY scripts/container-entrypoint.sh /usr/local/bin/coast-entrypoint
COPY scripts/container-storage.sh /usr/local/lib/coast-container-storage.sh
COPY scripts/container-wait.sh /usr/local/lib/coast-container-wait.sh
RUN chmod 755 /usr/local/bin/coast-entrypoint /usr/local/lib/coast-container-storage.sh /usr/local/lib/coast-container-wait.sh
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD bun -e 'const response = await fetch("http://127.0.0.1:3000/api/v1/health"); process.exit(response.ok ? 0 : 1)'
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/coast-entrypoint"]
