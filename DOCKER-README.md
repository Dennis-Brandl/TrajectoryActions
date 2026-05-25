# Trajectory Action Container — Docker Deployment Guide

The Action Container ships as **two images** built from one `Dockerfile`:

- **server** — the REST API (Node) + Python sandbox sidecar + SQLite (port 3002)
- **console** — the management UI (static SPA) served by nginx (port 3003), which reverse-proxies `/trajectory` and `/management` to the server

It can run with Docker, or be rebuilt locally from source.

## ⚠️ Build prerequisite: TrajectoryEditor must be a sibling

The console reuses the shared UI library that lives in **TrajectoryEditor** (`@trajectory/ui`, `@trajectory/tokens`, referenced via `file:` links). So the Docker build uses the **parent directory as its build context** and expects this layout:

```
<parent>/
  TrajectoryActions/      <- run docker compose here
  TrajectoryEditor/       <- must be present (the umbrella clone, or a sibling clone)
```

The `docker-compose.yml` sets `context: ..` automatically. A lone `TrajectoryActions` clone with no `TrajectoryEditor` sibling **cannot** build the console.

## Run with Docker

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (Engine or Desktop)
- `TrajectoryEditor` checked out next to `TrajectoryActions`

### Quick Start

From inside `TrajectoryActions/`:

```bash
docker compose up --build -d
```

- Console (UI): http://localhost:3003
- Server (REST API): http://localhost:3002

### Configuration

| Variable               | Default                                          | Where   | Description                                                    |
| ---------------------- | ------------------------------------------------ | ------- | -------------------------------------------------------------- |
| `PORT`                 | `3002`                                           | server  | REST API port                                                  |
| `DB_PATH`              | `/data/trajectory.db`                            | server  | SQLite path (persisted in the `trajectoryactions-data` volume) |
| `SIDECAR_SCRIPT`       | `/app/packages/python-sidecar/sandbox_runner.py` | server  | Python sandbox runner                                          |
| `ACTIONS_API_UPSTREAM` | `http://server:3002`                             | console | Upstream the console proxies API calls to                      |

### Data Management

- The SQLite database lives in the `trajectoryactions-data` volume (survives restarts).
- Reset: `docker compose down -v`

### Common Commands

```bash
docker compose up --build -d    # Build and start
docker compose up -d            # Start (already built)
docker compose down             # Stop
docker compose down -v          # Stop and delete the database volume
docker compose logs -f          # View live logs
```

## Rebuild locally (without Docker)

### Prerequisites

- Node.js 20+, Python 3 (on PATH as `python`), and `TrajectoryEditor` as a sibling

### Steps

```bash
npm install
npm run dev        # server (tsx, :3002) + console (Vite, :5176) via concurrently
```

The dev server reads `PORT` from a local `.env` (set `PORT=3002` to match the console's Vite proxy). For a production build of just the server packages: `npm run build` (`tsc --build`).

## Notes / validation

- These Docker files were authored without a local Docker engine. Validate with a real `docker compose up --build` before publishing. The console's cross-repo build (pulling the Editor's UI library) is the part most worth confirming.
- If `npm ci` fails due to a lockfile mismatch in either repo, switch the relevant `npm ci` to `npm install` in the `Dockerfile`.
- A dedicated unauthenticated `/health` route on the server would let the container use an HTTP healthcheck instead of the current TCP-port probe — a good small follow-up.
