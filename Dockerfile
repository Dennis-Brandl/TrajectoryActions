# =============================================================================
# Trajectory Action Container — Production Docker Image
#
# Builds TWO images from this one file (multi-stage, two targets):
#   - target "server"  : the REST API (Node) + Python sidecar + SQLite
#   - target "console" : the management UI (static SPA) served by nginx
#
# @trajectory/ui + @trajectory/tokens are vendored INSIDE TrajectoryActions
# (packages/ui, packages/tokens), so the console build is self-contained — no
# TrajectoryEditor checkout required. The compose service uses the parent dir as
# build context (dockerfile: TrajectoryActions/Dockerfile); the tokens' dist CSS
# is .dockerignored (**/dist) and so is regenerated from source in the builder.
#
# Recommended:
#     docker compose up --build -d
#
# Manual — run from the dir that holds TrajectoryActions:
#     docker build -f TrajectoryActions/Dockerfile --target server  -t trajectory-action-server  .
#     docker build -f TrajectoryActions/Dockerfile --target console -t trajectory-action-console .
#
# Ports: server 3002; console 80 (compose maps it to 3003).
#
# Validated locally via `docker compose build` (2026-06-13) after vendoring.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Builder — install workspace, build tokens, then server and console
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
ENV HUSKY=0
WORKDIR /app

# Toolchain for the better-sqlite3 native build
RUN apk add --no-cache python3 make g++

# --- TrajectoryActions: install, build vendored tokens, compile server, build console ---
COPY TrajectoryActions TrajectoryActions
# Cross-platform lockfile caveat (npm/cli#4828): the committed package-lock.json
# is host-generated and npm under-records the Alpine/musl native optional deps
# (@tailwindcss/oxide, lightningcss), so under `npm ci` their native bindings go
# uninstalled here and the console's vite build fails. Drop the lockfile so npm
# resolves the correct musl binaries fresh for this image (versions stay bounded
# by package.json; the repo + CI keep `npm ci` against the committed lock).
RUN cd TrajectoryActions && rm -f package-lock.json && npm install
# Regenerate the vendored design tokens → dist CSS. The console imports
# @trajectory/tokens/dist/*.css, but **/dist is stripped by .dockerignore, so
# rebuild it from the token source (style-dictionary is a tokens devDep).
RUN cd TrajectoryActions && npm -w @trajectory/tokens run build
# Compile the server's TS project graph (storage + engine + server) → dist
RUN cd TrajectoryActions && npx tsc --build packages/server
# Build the console SPA (Vite only — typecheck is not needed for the artifact)
RUN cd TrajectoryActions/apps/console && npm run build:help && npx vite build
# Bundle the server to one ESM file; better-sqlite3 stays external (native addon)
RUN cd TrajectoryActions && npx esbuild packages/server/src/index.ts \
      --bundle \
      --platform=node \
      --format=esm \
      --outfile=server.mjs \
      --external:better-sqlite3 \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# ---------------------------------------------------------------------------
# Stage 2a: server — Node REST API + Python sidecar + SQLite
# ---------------------------------------------------------------------------
FROM node:22-alpine AS server
WORKDIR /app

# python3 for the action sandbox sidecar (the engine spawns `python`, so add a
# `python` shim); make/g++ only to rebuild the native module, removed after.
RUN apk add --no-cache python3 make g++ \
 && ln -sf "$(which python3)" /usr/local/bin/python

# Bundled server + the native module (rebuilt for this image)
COPY --from=builder /app/TrajectoryActions/server.mjs ./server.mjs
COPY --from=builder /app/TrajectoryActions/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/TrajectoryActions/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/TrajectoryActions/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
RUN cd node_modules/better-sqlite3 && npx --yes node-gyp rebuild \
 && apk del make g++

# Python sidecar (stdlib only — no pip install required)
COPY --from=builder /app/TrajectoryActions/packages/python-sidecar ./packages/python-sidecar

# Entrypoint
COPY TrajectoryActions/docker-entrypoint.sh /app/docker-entrypoint.sh
# Normalize line endings: a stale CRLF checkout would make the shebang
# '#!/bin/sh\r' unrunnable (exec: no such file or directory). Strip CR so the
# image never depends on the host's git line-ending state.
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# Non-root runtime user; /data holds the SQLite DB
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
 && mkdir -p /data && chown -R appuser:appgroup /app /data
USER appuser

ENV NODE_ENV=production \
    PORT=3002 \
    DB_PATH=/data/trajectory.db \
    SIDECAR_SCRIPT=/app/packages/python-sidecar/sandbox_runner.py

EXPOSE 3002
VOLUME ["/data"]

# Probe the /health route (DB connectivity + schema present), not just the TCP
# port — an empty/incomplete database must report unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3002/health',r=>{r.resume();r.on('end',()=>process.exit(r.statusCode===200?0:1))}).on('error',()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]

# ---------------------------------------------------------------------------
# Stage 2b: console — static management UI via nginx
# ---------------------------------------------------------------------------
FROM nginx:alpine AS console

# SPA + reverse-proxy config. The official nginx image runs envsubst over
# /etc/nginx/templates/*.template at startup, filling ${ACTIONS_API_UPSTREAM}
# (nginx's own $host/$uri are left untouched — they are not env vars).
COPY TrajectoryActions/apps/console/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/TrajectoryActions/apps/console/dist /usr/share/nginx/html

ENV ACTIONS_API_UPSTREAM=http://actions-server:3002
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1
