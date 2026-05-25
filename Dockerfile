# =============================================================================
# Trajectory Action Container — Production Docker Image
#
# Builds TWO images from this one file (multi-stage, two targets):
#   - target "server"  : the REST API (Node) + Python sidecar + SQLite
#   - target "console" : the management UI (static SPA) served by nginx
#
# IMPORTANT — BUILD CONTEXT must be the PARENT directory that holds both
# `TrajectoryActions` and `TrajectoryEditor` as siblings. The console depends
# on @trajectory/ui + @trajectory/tokens (which live in TrajectoryEditor) via
# file: links, and the console build resolves @trajectory/ui's dependencies
# from the Editor's install — so the builder reproduces the dev layout:
# install the Editor workspace, build tokens, then install + build Actions.
#
# Recommended — run from inside TrajectoryActions/ (its compose sets the
# parent as context automatically):
#     docker compose up --build -d
#
# Manual — run from the parent dir that holds both repos as siblings:
#     docker build -f TrajectoryActions/Dockerfile --target server  -t trajectory-action-server  .
#     docker build -f TrajectoryActions/Dockerfile --target console -t trajectory-action-console .
#
# Ports: server 3002; console 80 (compose maps it to 3003).
#
# NOTE: this image has not been built locally (no Docker on the dev machine).
# Validate with a real `docker compose up --build` before publishing.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Builder — install both workspaces, build tokens, server and console
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
ENV HUSKY=0
WORKDIR /app

# Toolchain for the better-sqlite3 native build
RUN apk add --no-cache python3 make g++

# --- TrajectoryEditor: install the workspace so @trajectory/ui's deps and
#     @trajectory/tokens' build tooling are present for the console build.
#     (Only package manifests + the shared packages are needed — not the app.)
COPY TrajectoryEditor/package.json TrajectoryEditor/package-lock.json TrajectoryEditor/.npmrc TrajectoryEditor/
COPY TrajectoryEditor/packages TrajectoryEditor/packages
RUN cd TrajectoryEditor && npm ci
# Build design tokens → dist CSS (console imports @trajectory/tokens/dist/*.css)
RUN cd TrajectoryEditor && npm -w @trajectory/tokens run build

# --- TrajectoryActions: install, compile server packages, build console ---
COPY TrajectoryActions TrajectoryActions
RUN cd TrajectoryActions && npm ci
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
FROM node:20-alpine AS server
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
RUN chmod +x /app/docker-entrypoint.sh

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

# No dedicated /health route exists yet, so probe the TCP port with Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const s=require('net').connect(3002,'127.0.0.1');s.setTimeout(3000);s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1))"

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
  CMD wget -q -O /dev/null http://localhost:80/ || exit 1
