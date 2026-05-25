#!/bin/sh
set -e

# Ensure the SQLite data directory exists (better-sqlite3 refuses to open a
# database when its parent directory is missing). /data is normally a mounted
# volume, but mkdir -p is safe and covers the no-volume case.
mkdir -p "$(dirname "${DB_PATH:-/data/trajectory.db}")"

exec node /app/server.mjs
