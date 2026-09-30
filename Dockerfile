# syntax=docker/dockerfile:1.7
#
# RADAR app image — one image, two roles (docker-compose.yml):
#   app     `web`    : applies migrations, then serves the Next.js standalone server on :3000
#   worker  `worker` : waits for migrations, then runs the scheduler (dist/worker.mjs)
# plus one-off modes (cli, seed, eval, migrate, hash-password) — see ops/docker/entrypoint.sh.
#
# Build:  docker compose build --builder radar-builder   (ops/lib/common.sh radar_compose_build:
#         RADAR's own buildx builder, capped at 3 GiB RAM / no swap / 1 CPU; GIT_SHA is passed by
#         ops/deploy.sh / ops/autodeploy.sh). CI builds it with plain `docker build`.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------------------------
# deps: exact dependency tree from package-lock.json (dev deps included: the build needs them).
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci

# ---------------------------------------------------------------------------------------------
# build: Next.js standalone output + esbuild bundles in dist/.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# The V8 heap cap is NOT what protects the other services on the VPS: `next build` uses Turbopack,
# whose native memory it does not bound, and Next's worker processes each get their own heap.
# The real ceiling is the cgroup of the radar-builder BuildKit container (3 GiB, no swap, 1 CPU;
# docs/DEPLOY.md §4). The cap stays below that so a JS-heavy step fails with a clear "heap out of
# memory" instead of an OOM kill of the build container.
ARG BUILD_MAX_OLD_SPACE_MB=2048
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked \
    NODE_OPTIONS="--max-old-space-size=${BUILD_MAX_OLD_SPACE_MB}" npm run build
# No --allow-missing here: every entry point (worker, cli, migrate, seed, eval, …) must exist,
# otherwise the image build fails.
RUN node scripts/build-worker.mjs \
 && test -f .next/standalone/server.js \
 && test -f drizzle/meta/_journal.json

# ---------------------------------------------------------------------------------------------
# runner: no compilers, no dev deps, no source; non-root; tini as PID 1.
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 radar \
 && useradd --system --uid 10001 --gid radar --home-dir /app --no-create-home --shell /usr/sbin/nologin radar

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MIGRATIONS_DIR=/app/drizzle

# Code is root-owned and read-only for the app user; only the Next cache dir is writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/dist ./dist
COPY ops/docker/entrypoint.sh /usr/local/bin/radar-entrypoint
RUN chmod 0755 /usr/local/bin/radar-entrypoint \
 && mkdir -p /app/.next/cache \
 && chown radar:radar /app/.next/cache

USER radar
EXPOSE 3000

# Only meaningful for the `web` role; docker-compose.yml disables it for the worker.
HEALTHCHECK --interval=30s --timeout=6s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Last, so a new commit only rebuilds this metadata layer.
ARG GIT_SHA=
ENV GIT_SHA=${GIT_SHA}
LABEL com.radar.project="radar" \
      org.opencontainers.image.title="radar" \
      org.opencontainers.image.revision="${GIT_SHA}"

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/radar-entrypoint"]
CMD ["web"]
