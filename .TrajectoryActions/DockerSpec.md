# Trajectory Action Container — Docker Specification

## Overview

The Action Container is deployed as a single Docker container that includes Node.js (server + management console), Python (sandboxed action code execution), and SQLite (persistent storage). A multi-stage Dockerfile builds the React console SPA and the TypeScript server, then assembles a production image.

---

## 1. Dockerfile

```dockerfile
# ============================================================
# Stage 1: Build React Management Console
# ============================================================
FROM node:20-alpine AS console-builder

WORKDIR /build/console
COPY apps/console/package.json apps/console/package-lock.json ./
RUN npm ci
COPY apps/console/ ./
RUN npm run build
# Output: /build/console/dist/

# ============================================================
# Stage 2: Build TypeScript Server + Engine + Storage
# ============================================================
FROM node:20-alpine AS server-builder

WORKDIR /build
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/ packages/
RUN npm ci
RUN npm run build
# Output: /build/packages/*/dist/

# ============================================================
# Stage 3: Production Image
# ============================================================
FROM node:20-alpine AS production

# Install Python 3.12
RUN apk add --no-cache python3 py3-pip

# Create app directory
WORKDIR /app

# Copy server build
COPY --from=server-builder /build/package.json /build/package-lock.json ./
COPY --from=server-builder /build/packages/ packages/
RUN npm ci --production

# Copy console SPA
COPY --from=console-builder /build/console/dist/ /app/console-dist/

# Copy Python sidecar
COPY python/ /app/python/
RUN pip3 install --no-cache-dir -r /app/python/requirements.txt

# Create data directory
RUN mkdir -p /data /data/uploads

# Set environment defaults
ENV PORT=3000
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PYTHON_EXECUTABLE=python3

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/trajectory/v1/health || exit 1

# Start server
CMD ["node", "packages/server/dist/index.js"]
```

---

## 2. Docker Compose

```yaml
version: '3.8'

services:
  Trajectory-action-container:
    build:
      context: .
      dockerfile: docker/Dockerfile
    container_name: Trajectory-actions
    ports:
      - '${PORT:-3000}:3000'
    volumes:
      - trajectory-data:/data
    environment:
      - PORT=3000
      - LOG_MAX_SIZE=10000
      - PYTHON_POOL_SIZE=4
      - EXECUTION_TIMEOUT_MS=60000
      - INSTANCE_RETENTION_HOURS=24
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'

volumes:
  trajectory-data:
    driver: local
```

---

## 3. Environment Variables

| Variable                   | Default      | Description                                                             |
| -------------------------- | ------------ | ----------------------------------------------------------------------- |
| `PORT`                     | `3000`       | HTTP server port                                                        |
| `DATA_DIR`                 | `/data`      | Persistent data directory (SQLite database + uploads)                   |
| `LOG_MAX_SIZE`             | `10000`      | Initial max execution log entries (overrides DB default on first start) |
| `PYTHON_POOL_SIZE`         | `4`          | Number of Python subprocess workers                                     |
| `EXECUTION_TIMEOUT_MS`     | `60000`      | Default Python execution timeout per state                              |
| `INSTANCE_RETENTION_HOURS` | `24`         | Hours to retain completed instance records                              |
| `PYTHON_EXECUTABLE`        | `python3`    | Path to Python interpreter                                              |
| `NODE_ENV`                 | `production` | Node.js environment mode                                                |

Environment variables set initial values on first container start. After that, settings are managed via the Management Console (stored in SQLite). Environment variables do NOT override database settings on subsequent starts — the database is the source of truth once initialized.

---

## 4. Volume Mounts

### 4.1 Named Volume (Recommended)

```yaml
volumes:
  - trajectory-data:/data
```

Docker manages the volume. Data persists across container restarts and rebuilds.

### 4.2 Bind Mount (Alternative)

```yaml
volumes:
  - ./trajectory-data:/data
```

Maps to a host directory. Useful for development and easy backup access.

### 4.3 Volume Contents

```
/data/
├── database.sqlite           # SQLite database
└── uploads/                  # Archived package files
    ├── 2026-02-21T09-00-00Z_KitchenEnv.WFenvir
    └── 2026-02-22T14-30-00Z_Factory.WFenvir
```

---

## 5. Port Mapping

Single port serves all traffic:

| Internal Port | Default External | Path               | Handler                  |
| ------------- | ---------------- | ------------------ | ------------------------ |
| 3000          | 3000             | `/trajectory/v1/*` | Trajectory REST protocol |
| 3000          | 3000             | `/management/v1/*` | Management console API   |
| 3000          | 3000             | `/console/*`       | Management console SPA   |
| 3000          | 3000             | `/`                | Redirect → `/console/`   |

To expose on a different host port:

```yaml
ports:
  - '8080:3000'
```

---

## 6. Container Lifecycle

### 6.1 Startup Sequence

1. Node.js process starts (`packages/server/dist/index.js`)
2. Initialize SQLite database connection (`/data/database.sqlite`)
3. Run pending database migrations
4. Seed default settings (if first start, apply environment variable overrides)
5. Start Python subprocess pool (spawn `PYTHON_POOL_SIZE` workers)
6. Mount Express routes (Trajectory API, Management API, static files)
7. Begin listening on `PORT`
8. Log startup message to stdout

### 6.2 Graceful Shutdown

On `SIGTERM` or `SIGINT`:

1. Stop accepting new HTTP connections
2. Wait for in-flight requests to complete (30-second grace period)
3. Send ABORT to all active action instances
4. Terminate Python subprocess pool (SIGTERM, then SIGKILL after 5 seconds)
5. Write final execution log entries for any incomplete instances
6. Close SQLite database connection
7. Exit process

### 6.3 Health Check

The Docker HEALTHCHECK calls `GET /trajectory/v1/health` every 30 seconds. The health endpoint returns:

- `"healthy"` — Server is running, database is accessible, at least one Python worker is available
- `"degraded"` — Server is running but all Python workers are busy or some have crashed
- `"unhealthy"` — Database is inaccessible or no Python workers are alive

---

## 7. Resource Requirements

### 7.1 Minimum

| Resource | Minimum                                |
| -------- | -------------------------------------- |
| CPU      | 1 core                                 |
| Memory   | 512 MB                                 |
| Disk     | 100 MB (image) + volume space for data |

### 7.2 Recommended

| Resource | Recommended                  |
| -------- | ---------------------------- |
| CPU      | 2 cores                      |
| Memory   | 1 GB                         |
| Disk     | 500 MB (image) + 1 GB volume |

Memory scales with `PYTHON_POOL_SIZE` — each Python subprocess uses approximately 50-100 MB.

---

## 8. Development Mode

For local development without Docker:

```bash
# Terminal 1: Start server (with hot reload)
cd packages/server
npm run dev

# Terminal 2: Start console (Vite dev server with proxy)
cd apps/console
npm run dev
```

The Vite dev server proxies `/trajectory/v1/*` and `/management/v1/*` to the local Express server (port 3001 in dev mode). The console runs on port 5176 with HMR.

Development `.env` file:

```env
PORT=3001
DATA_DIR=./dev-data
PYTHON_POOL_SIZE=2
EXECUTION_TIMEOUT_MS=30000
LOG_MAX_SIZE=1000
```

---

## 9. Logging

Container logs go to stdout/stderr (Docker captures them):

| Level | Content                                                             |
| ----- | ------------------------------------------------------------------- |
| INFO  | HTTP requests, state transitions, instance lifecycle                |
| WARN  | Pool exhaustion, execution timeouts, failed imports                 |
| ERROR | Python subprocess crashes, database errors, unhandled exceptions    |
| DEBUG | Parameter resolution, code version pinning (disabled in production) |

Log format:

```
[2026-02-24T10:31:00.000Z] [INFO]  POST /trajectory/v1/actions/act-001/invoke → 201 (15ms)
[2026-02-24T10:31:02.000Z] [INFO]  Instance rai-uuid: STARTING → EXECUTING
[2026-02-24T10:31:02.000Z] [INFO]  Instance rai-uuid: executing EXECUTING code (v3)
[2026-02-24T10:35:00.000Z] [INFO]  Instance rai-uuid: COMPLETING → COMPLETED (total: 4.0s)
```

Access container logs:

```bash
docker logs Trajectory-actions
docker logs -f Trajectory-actions  # Follow
```
