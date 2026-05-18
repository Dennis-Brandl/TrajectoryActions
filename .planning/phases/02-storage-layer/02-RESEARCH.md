# Phase 2: Storage Layer - Research

**Researched:** 2026-02-25
**Domain:** better-sqlite3, SQLite repository pattern, TypeScript ESM/CJS interop, migration systems
**Confidence:** HIGH (core API verified against official docs and DefinitelyTyped; ESM interop verified against TypeScript docs and GitHub issues)

---

## Summary

Phase 2 builds a complete SQLite persistence layer on top of `better-sqlite3` v12.6.2 (released January 2026). The schema is fully specified in StorageSpec.md — the research task is to understand the correct patterns for using better-sqlite3 in this project's specific environment: a TypeScript ESM package (`"type": "module"`, NodeNext, `verbatimModuleSyntax: true`) with no ORM. The standard approach for this stack is to write a thin, hand-rolled migration runner and repository classes that wrap prepared statements — no migration library is needed.

The most important finding is the **ESM/CJS interop pattern**. `better-sqlite3` is a native CommonJS module with `@types/better-sqlite3` declaring `export =`. In an ESM package with `"type": "module"` and `esModuleInterop: true`, Node.js's built-in CJS-from-ESM interop makes the default import work at runtime, and TypeScript with `esModuleInterop: true` allows `import Database from 'better-sqlite3'` at the type level. The `verbatimModuleSyntax: true` flag does not block this — it restricts how _this package's_ exports are written, not how CJS externals are imported.

The second key finding is that **better-sqlite3 is a native Node.js addon** (requires node-gyp compilation or prebuilt binaries). This has build-time implications for Docker and CI — the package must be installed in the target OS/arch environment, and `@types/better-sqlite3` must be a separate devDependency since types are not bundled.

**Primary recommendation:** `import Database from 'better-sqlite3'` with `@types/better-sqlite3` as devDependency. Write a custom migration runner (40 lines of TypeScript) using the `_migrations` table pattern. Use `db.transaction()` for all multi-step operations. Serialize all JSON columns with `JSON.stringify`/`JSON.parse`. Store booleans as `INTEGER 0/1`.

---

## Standard Stack

### Core

| Library               | Version         | Purpose                             | Why Standard                                                                                                                         |
| --------------------- | --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| better-sqlite3        | 12.6.2          | Synchronous SQLite driver           | Fastest SQLite driver for Node; synchronous API is ideal for this use case — no async/await boilerplate, transactions work naturally |
| @types/better-sqlite3 | latest (~7.6.x) | TypeScript types for better-sqlite3 | Types are not bundled in the main package; DefinitelyTyped is the authoritative source                                               |

### Supporting

| Library             | Version            | Purpose                               | When to Use                                                                                        |
| ------------------- | ------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| node-gyp (implicit) | via better-sqlite3 | Native addon build tool               | Automatic during `npm install` if no prebuilt binary found; no direct dependency                   |
| uuid                | latest             | Generate UUIDs for `code_versions.id` | Only if nanoid/crypto.randomUUID not preferred; note: `crypto.randomUUID()` is built into Node 20+ |

### Alternatives Considered

| Instead of              | Could Use                            | Tradeoff                                                                                                                                        |
| ----------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| better-sqlite3          | node:sqlite (Node 22+ built-in)      | Node 22 built-in is async; this project uses Node 20+ and better-sqlite3 is locked by spec                                                      |
| better-sqlite3          | Drizzle ORM + better-sqlite3         | ORM adds type-safety for queries but this project's schema is fully specified — hand-rolled repos are simpler and more predictable              |
| Custom migration runner | better-sqlite3-migrations, sqlite-up | Third-party migration libs add dependency for 40 lines of logic; custom runner owns the `_migrations` table convention exactly as spec requires |
| `crypto.randomUUID()`   | `uuid` package                       | `crypto.randomUUID()` is built into Node 20+ and requires no dependency — prefer it                                                             |

**Installation (packages/storage):**

```bash
npm install better-sqlite3 --workspace=packages/storage
npm install --save-dev @types/better-sqlite3 --workspace=packages/storage
```

---

## Architecture Patterns

### Recommended Project Structure

```
packages/storage/src/
├── index.ts                    # Public exports
├── database.ts                 # DB connection singleton (open, pragmas, WAL)
├── migrations/
│   ├── runner.ts               # Migration runner (reads _migrations, applies in order)
│   └── 001-initial-schema.ts   # First migration: all 6 tables + settings seed
├── repositories/
│   ├── environment.repository.ts
│   ├── action.repository.ts
│   ├── code-version.repository.ts
│   ├── instance.repository.ts
│   ├── log.repository.ts
│   └── settings.repository.ts
├── types.ts                    # Shared domain types (row shapes, input types)
└── transaction.ts              # Transaction helper utilities
```

### Pattern 1: Database Singleton Module

**What:** Export a single initialized `Database` instance from `database.ts`. Open the connection, set pragmas, then run migrations. All repositories receive this instance.

**When to use:** Single-process Node.js app with one SQLite file — exactly this use case.

```typescript
// Source: better-sqlite3 official API docs (github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'

const DB_PATH = process.env['DB_PATH'] ?? '/data/database.sqlite'

function openDatabase(path: string): BetterSqlite3.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL') // safe with WAL; improves throughput
  return db
}

export const db = openDatabase(DB_PATH)
```

**Note on import syntax:** `import Database from 'better-sqlite3'` works in this ESM package because:

1. Node.js allows CJS modules to be default-imported from ESM (the module's `module.exports` becomes the default)
2. `esModuleInterop: true` in `tsconfig.base.json` tells TypeScript to accept this at the type level
3. The `@types/better-sqlite3` uses `export =` (DefinitelyTyped canonical test file uses `import Sqlite = require()`), but with `esModuleInterop: true`, TypeScript allows the `import X from` form as equivalent

### Pattern 2: Migration Runner

**What:** A `runner.ts` that creates `_migrations` table if absent, reads already-applied migration names, then applies any unapplied migrations in sorted order — all in a transaction.

**When to use:** Every server startup. Migrations are idempotent.

```typescript
// Source: Pattern derived from StorageSpec.md requirements + official better-sqlite3 transaction API
import { db } from './database.js'
import type BetterSqlite3 from 'better-sqlite3'

export interface Migration {
  name: string
  up: (db: BetterSqlite3.Database) => void
}

export function runMigrations(migrations: Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  const getApplied = db.prepare<[], { name: string }>('SELECT name FROM _migrations ORDER BY name')
  const applied = new Set(getApplied.all().map((r) => r.name))

  const insertMigration = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')

  const applyAll = db.transaction(() => {
    for (const migration of migrations.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!applied.has(migration.name)) {
        migration.up(db)
        insertMigration.run(migration.name, new Date().toISOString())
      }
    }
  })

  applyAll()
}
```

### Pattern 3: Repository Class

**What:** Each repository receives the `db` instance, pre-compiles frequently used statements in the constructor, and exposes domain methods with typed inputs/outputs.

**When to use:** All 6 repositories in this phase.

```typescript
// Source: better-sqlite3 official API docs — prepared statement pattern
import { db } from '../database.js'
import type BetterSqlite3 from 'better-sqlite3'

// Row type (what comes back from SQLite — JSON fields as strings, booleans as 0|1)
interface EnvironmentRow {
  oid: string
  local_id: string
  version: string
  last_modified_date: string
  description: string | null
  schema_version: string
  action_property_specifications: string // JSON string
  value_property_specifications: string // JSON string
  resource_property_specifications: string // JSON string
  imported_at: string
  source_filename: string
}

export class EnvironmentRepository {
  private readonly stmtFindByOid: BetterSqlite3.Statement<[string], EnvironmentRow>
  private readonly stmtInsert: BetterSqlite3.Statement

  constructor(private readonly db: BetterSqlite3.Database) {
    this.stmtFindByOid = db.prepare('SELECT * FROM environments WHERE oid = ?')
    this.stmtInsert = db.prepare(`
      INSERT INTO environments (oid, local_id, version, ...) VALUES (?, ?, ?, ...)
    `)
  }
}
```

### Pattern 4: JSON Column Serialization

**What:** All array/object columns (TEXT columns storing JSON) must be serialized on write and deserialized on read. better-sqlite3 does NOT auto-parse JSON.

```typescript
// Source: better-sqlite3 GitHub discussion #1098 — confirmed no auto-JSON
function toRow(env: EnvironmentInput): EnvironmentRow {
  return {
    ...env,
    action_property_specifications: JSON.stringify(env.actionPropertySpecifications),
    value_property_specifications: JSON.stringify(env.valuePropertySpecifications),
    resource_property_specifications: JSON.stringify(env.resourcePropertySpecifications),
  }
}

function fromRow(row: EnvironmentRow): Environment {
  return {
    ...row,
    actionPropertySpecifications: JSON.parse(row.action_property_specifications),
    valuePropertySpecifications: JSON.parse(row.value_property_specifications),
    resourcePropertySpecifications: JSON.parse(row.resource_property_specifications),
  }
}
```

### Pattern 5: Boolean Columns

**What:** SQLite has no boolean type. The schema uses `INTEGER NOT NULL DEFAULT 0` (e.g., `is_active`, `is_logged`). better-sqlite3 returns these as JavaScript `number` (0 or 1), not `boolean`.

```typescript
// Serialize: boolean → 0|1
const isActive: number = codeVersion.isActive ? 1 : 0

// Deserialize: 0|1 → boolean
const isActive: boolean = row.is_active === 1
```

### Pattern 6: Transaction Wrapping for Critical Operations

**What:** `db.transaction(fn)` returns a function. Call the returned function to execute. Errors cause automatic rollback. Nesting is safe (uses savepoints).

```typescript
// Source: better-sqlite3 official API docs — transaction method
const importEnvironment = db.transaction((env: EnvironmentInput, actions: ActionInput[]) => {
  envStmt.run(toEnvRow(env))
  for (const action of actions) {
    actionStmt.run(toActionRow(action))
  }
})

// Usage — throws on failure, rolls back automatically
importEnvironment(envData, actionsData)
```

**CRITICAL:** `db.transaction()` does NOT work with async functions. The transaction function must be synchronous. better-sqlite3's synchronous API makes this natural.

### Anti-Patterns to Avoid

- **Not enabling WAL mode:** WAL (`journal_mode = WAL`) dramatically improves concurrent read throughput. Always set before any operations.
- **Not enabling foreign keys:** SQLite disables FK enforcement by default. `PRAGMA foreign_keys = ON` must be set on every connection open (it does not persist between connections).
- **Opening foreign_keys pragma mid-transaction:** Cannot change `foreign_keys` setting while a transaction is open. Set it immediately after opening the connection, before any operations.
- **Using `db.exec()` for parameterized queries:** `exec()` takes raw SQL strings with no parameter binding — never use it with user data. Use `db.prepare()` for any query with dynamic values.
- **Not pre-compiling statements:** `db.prepare()` in repository constructors, not in each method call. Repeated `prepare()` calls per query incur parsing overhead.
- **Treating transaction functions as async:** `db.transaction()` wraps SYNCHRONOUS functions only. An async function returns after the first `await`, breaking the transaction lifecycle.

---

## Don't Hand-Roll

| Problem                    | Don't Build                    | Use Instead                                                    | Why                                                                    |
| -------------------------- | ------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| UUID generation            | Custom random string           | `crypto.randomUUID()` (Node 20+ built-in)                      | Built-in, RFC 4122 compliant, no dependency                            |
| WAL mode setup             | Custom file locking            | `db.pragma('journal_mode = WAL')`                              | SQLite's built-in WAL; anything else is wrong                          |
| Transaction management     | try/catch/rollback manually    | `db.transaction(fn)`                                           | better-sqlite3 handles commit/rollback; manual approach is error-prone |
| Migration tracking         | Custom version table schema    | `_migrations` table with name + applied_at                     | Simple, reliable, matches spec                                         |
| JSON column handling       | SQLite JSON1 extension queries | `JSON.stringify`/`JSON.parse` at repository boundary           | Spec stores as TEXT; no need for JSON1 query features                  |
| Row count for log trimming | COUNT(\*) on every insert      | `db.prepare('SELECT COUNT(*) ...').pluck(true)` + batch DELETE | better-sqlite3 `.pluck()` returns scalar directly                      |

**Key insight:** better-sqlite3 is a thin synchronous wrapper with a great API. The "don't hand-roll" principle here applies to avoiding unnecessary abstraction layers (no ORM needed) while using the library's built-in patterns (transactions, prepared statements) rather than building custom equivalents.

---

## Common Pitfalls

### Pitfall 1: Foreign Keys Disabled by Default

**What goes wrong:** Cascade deletes (environments → actions → code_versions) silently do nothing. Referential integrity checks fail silently. Actions can be inserted with invalid `environment_oid`.

**Why it happens:** SQLite disables FK enforcement for backwards compatibility. It's a per-connection setting, not a database-file setting.

**How to avoid:** Always call `db.pragma('foreign_keys = ON')` immediately after opening the database connection, before any other operations. This is done once in `database.ts`.

**Warning signs:** Deleting an environment doesn't cascade-delete its actions.

---

### Pitfall 2: better-sqlite3 Is a Native Addon (Prebuilt Binary Issue)

**What goes wrong:** `npm install` fails in Docker or CI with errors about `node-gyp`, missing Python, missing build tools, or "no prebuilt binary for your platform."

**Why it happens:** better-sqlite3 contains C++ that must be compiled for the host OS + Node.js version + architecture combination. Prebuilt binaries exist for common LTS combinations. Unusual combos (Alpine Linux, ARM64) require native compilation.

**How to avoid:**

- In Dockerfile: ensure build dependencies are available (`build-essential`, `python3`) if not on a standard Node LTS image
- Run `npm install` inside the target Docker container, not on the host
- Use the same Node.js version in development, CI, and production

**Warning signs:** Error messages containing `node-gyp rebuild`, "No prebuilt binaries", or "ENOENT python".

---

### Pitfall 3: ESM Import of CJS Module

**What goes wrong:** TypeScript compiler error on `import Database from 'better-sqlite3'` with message like "Module can only be default-imported using the 'esModuleInterop' flag" or runtime `SyntaxError`.

**Why it happens:** `@types/better-sqlite3` uses `export = Database` (CommonJS-style), and the package itself is CJS. ESM-first TypeScript projects sometimes get confused about which import style to use.

**How to avoid:**

- Confirm `esModuleInterop: true` in `tsconfig.base.json` (it is already set per Phase 1)
- Use `import Database from 'better-sqlite3'` (default import)
- Use `import type BetterSqlite3 from 'better-sqlite3'` for type-only imports of the namespace
- Do NOT use `import * as Database from 'better-sqlite3'` (namespace import) — returns the wrong shape
- Do NOT use `import Database = require('better-sqlite3')` — this is CJS require syntax, not valid in ESM files

**Warning signs:** TypeScript error TS1259 ("can only be default-imported using 'esModuleInterop'") or runtime `ERR_REQUIRE_ESM`.

---

### Pitfall 4: JSON Columns Not Parsed on Read

**What goes wrong:** Repository returns rows where array fields (e.g., `actionPropertySpecifications`) are strings instead of arrays. Downstream code breaks with type errors.

**Why it happens:** better-sqlite3 returns TEXT columns as JavaScript strings exactly as stored. It performs zero JSON parsing.

**How to avoid:** Every repository's `fromRow()` private method must `JSON.parse()` every JSON column. Write unit tests that verify the deserialized shape.

**Warning signs:** `typeof result.actionPropertySpecifications === 'string'` when it should be `object`.

---

### Pitfall 5: Async Functions in Transactions

**What goes wrong:** Code inside `db.transaction(async fn)` starts executing, hits an `await`, returns a Promise, and the transaction commits immediately — before the async work completes.

**Why it happens:** JavaScript Promises are scheduled after the current call stack returns. better-sqlite3 transactions commit when the wrapped function returns. An async function returns a Promise on the first `await`.

**How to avoid:** All repository and transaction code must be synchronous. This is enforced by better-sqlite3's synchronous API — if you find yourself wanting `await` inside a transaction, redesign the data flow.

**Warning signs:** Transactions that appear to succeed but data is missing, or transactions that commit before all inserts run.

---

### Pitfall 6: SQLITE_BUSY Under Concurrent Writes

**What goes wrong:** When multiple operations attempt to write simultaneously (unlikely with a single Node.js process but possible during testing with concurrent test files), the second writer gets `SQLITE_BUSY`.

**Why it happens:** WAL mode allows concurrent readers but only one writer at a time. The `timeout` option in the Database constructor sets how long to wait before throwing.

**How to avoid:** The default `timeout: 5000` (5 seconds) in better-sqlite3 is generous. For testing, use `:memory:` databases — one per test suite — to avoid any contention.

**Warning signs:** `SqliteError: database is locked` in tests.

---

### Pitfall 7: Partial Index (WHERE clause) — Verify It's Used

**What goes wrong:** The `idx_code_versions_active` partial index (`WHERE is_active = 1`) exists in the schema but the query planner doesn't use it because the query is written differently.

**Why it happens:** SQLite only uses a partial index when the query's WHERE clause logically implies the index's WHERE clause.

**How to avoid:** When querying active code versions, always filter `WHERE is_active = 1` explicitly. Use `EXPLAIN QUERY PLAN` during development to verify index usage.

**Warning signs:** Slow queries on `code_versions` table when fetching the active version.

---

## Code Examples

Verified patterns from official sources:

### Opening the Database (WAL + Foreign Keys)

```typescript
// Source: better-sqlite3 API docs (github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
import Database from 'better-sqlite3'

const db = new Database('/data/database.sqlite', {
  timeout: 5000, // ms to wait on SQLITE_BUSY before throwing
})
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('synchronous = NORMAL') // safe with WAL; default is FULL
```

### Prepared Statement (typed result)

```typescript
// Source: @types/better-sqlite3 — Statement<BindParameters, Result>
interface CodeVersionRow {
  id: string
  action_oid: string
  state: string
  version_number: number
  source_code: string
  is_active: number // 0 or 1, NOT boolean
  created_at: string
  created_by: string | null
  description: string | null
}

const stmtGetActive = db.prepare<[string, string], CodeVersionRow>(
  'SELECT * FROM code_versions WHERE action_oid = ? AND state = ? AND is_active = 1'
)

const row = stmtGetActive.get(actionOid, state) // returns CodeVersionRow | undefined
```

### Transaction (multi-step import)

```typescript
// Source: better-sqlite3 API docs — transaction method
const performImport = db.transaction((environmentRow: EnvironmentRow, actionRows: ActionRow[]) => {
  stmtInsertEnv.run(environmentRow)
  for (const actionRow of actionRows) {
    stmtInsertAction.run(actionRow)
  }
})

performImport(envRow, actRows) // commits on success, rollbacks on throw
```

### Auto-incrementing Version Number

```typescript
// Source: StorageSpec.md schema — UNIQUE(action_oid, state, version_number) + auto-increment pattern
// Get next version number for an action+state pair
const stmtMaxVersion = db.prepare<[string, string], { max_version: number | null }>(
  'SELECT MAX(version_number) as max_version FROM code_versions WHERE action_oid = ? AND state = ?'
)

function nextVersionNumber(actionOid: string, state: string): number {
  const row = stmtMaxVersion.get(actionOid, state)
  return (row?.max_version ?? 0) + 1
}
```

### Rolling Log Trim (after each insert)

```typescript
// Source: StorageSpec.md §2 — Rolling Log Mechanics
const stmtCount = db
  .prepare<[], { count: number }>('SELECT COUNT(*) as count FROM execution_log')
  .pluck(false)
const stmtDeleteOldest = db.prepare<[number], void>(
  'DELETE FROM execution_log WHERE id IN (SELECT id FROM execution_log ORDER BY id ASC LIMIT ?)'
)

const trimLog = db.transaction((maxSize: number) => {
  const { count } = stmtCount.get() as { count: number }
  if (count > maxSize) {
    stmtDeleteOldest.run(count - maxSize)
  }
})
```

### In-Memory Database for Tests

```typescript
// Source: better-sqlite3 API docs — ':memory:' database path
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations/runner.js'

function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db) // apply schema to in-memory db
  return db
}
```

### Migration File Convention

```typescript
// packages/storage/src/migrations/001-initial-schema.ts
import type { Migration } from './runner.js'

export const migration: Migration = {
  name: '001-initial-schema',
  up(db) {
    db.exec(`
      CREATE TABLE environments (
        oid TEXT PRIMARY KEY,
        ...
      );
      -- all 6 tables in one migration
    `)
    // Seed default settings
    db.prepare(
      `INSERT INTO settings (key, value, default_value, description, value_type) VALUES (?, ?, ?, ?, ?)`
    ).run(
      'log_max_size',
      '10000',
      '10000',
      'Maximum execution log entries before rollover',
      'number'
    )
    // ... repeat for other 3 settings
  },
}
```

---

## State of the Art

| Old Approach                           | Current Approach                              | When Changed                                  | Impact                                                                  |
| -------------------------------------- | --------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `require('better-sqlite3')` (CJS)      | `import Database from 'better-sqlite3'` (ESM) | Node.js ESM adoption ~2022-2023               | Works via Node's CJS-from-ESM interop; `esModuleInterop: true` required |
| `node:sqlite` as alternative           | Prefer `better-sqlite3` for this project      | Node 22 added built-in SQLite                 | Built-in is async-first; spec mandates better-sqlite3's synchronous API |
| Migration libraries (db-migrate, knex) | Custom runner (40 lines)                      | Not a change — just simpler for this use case | No extra dependency; full control of `_migrations` schema               |
| BigInt for 64-bit integers             | Use regular numbers (safe for this schema)    | N/A                                           | SQLite INTEGER fits in JS Number for all values in this schema          |

**Deprecated/outdated:**

- `@types/better-sqlite3` with separate install: Types ARE separate (DefinitelyTyped); confirm `npm install --save-dev @types/better-sqlite3`. Better-sqlite3 itself does NOT bundle types.
- `node-sqlite3` (the async one): Do not confuse with better-sqlite3. The spec mandates better-sqlite3 (synchronous).

---

## Open Questions

1. **`@types/better-sqlite3` version alignment**
   - What we know: The latest `@types/better-sqlite3` is a community-maintained DefinitelyTyped package; `better-sqlite3` is 12.6.2
   - What's unclear: Whether the current `@types/better-sqlite3` fully covers v12.6.x API or lags slightly
   - Recommendation: Install latest `@types/better-sqlite3`, confirm `BetterSqlite3.Database` and `BetterSqlite3.Statement` type parameters match usage patterns at implementation time

2. **Dev database file location**
   - What we know: Production path is `/data/database.sqlite` (Docker volume); CONTEXT.md marks this as Claude's Discretion
   - What's unclear: Where to put the dev database file locally (not in-container)
   - Recommendation: Use `./data/database.sqlite` relative to repo root for dev (match the Docker volume structure); add `data/*.sqlite` to `.gitignore`

3. **Test isolation strategy for repository tests**
   - What we know: better-sqlite3 supports `:memory:` databases for testing; CONTEXT.md marks this as Claude's Discretion
   - What's unclear: Whether to use one shared `:memory:` database per test file or one per test
   - Recommendation: One `:memory:` database per test file (created in `beforeAll`, destroyed in `afterAll`); reset between tests with `DELETE FROM tablename` or per-test transactions that always roll back

4. **Archive file system access from tests**
   - What we know: Environment delete must write archive JSON to `/data/archives/{timestamp}_{oid}_{localId}.json`
   - What's unclear: How to test this without hitting the real filesystem path
   - Recommendation: Accept `archivePath` as a constructor parameter on EnvironmentRepository (or a separate ArchiveService), default to `/data/archives` in production; override in tests

---

## Sources

### Primary (HIGH confidence)

- `github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md` — Core API: Database constructor, pragma, exec, prepare, transaction, Statement methods
- `github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/better-sqlite3/index.d.ts` — TypeScript type definitions: `export =` style, Statement generic params, RunResult
- `github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/better-sqlite3/better-sqlite3-tests.ts` — Canonical import syntax: `import Sqlite = require("better-sqlite3")`
- `sqlite.org/foreignkeys.html` — Foreign key pragma behavior, per-connection requirement
- `sqlite.org/partialindex.html` — Partial index WHERE clause limitations

### Secondary (MEDIUM confidence)

- `github.com/WiseLibs/better-sqlite3/releases` — v12.6.2 confirmed as latest (released January 16, 2026)
- `github.com/WiseLibs/better-sqlite3/pull/1293` — ESM migration PR closed January 2025; confirmed better-sqlite3 remains CJS permanently
- Multiple WebSearch results confirming: `import Database from 'better-sqlite3'` works with `esModuleInterop: true`
- `sqlite.org/wal.html` — WAL mode behavior, concurrent readers/writers, WAL+synchronous=NORMAL safety

### Tertiary (LOW confidence)

- Community examples showing `import Database from 'better-sqlite3'` with `"type": "module"` packages — consistent but not from official source
- Pattern for `synchronous = NORMAL` with WAL — widely recommended in community articles, safe per SQLite docs on WAL mode

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — better-sqlite3 v12.6.2 verified from GitHub releases; `@types/better-sqlite3` from DefinitelyTyped
- Architecture: HIGH — patterns derived from official API docs and StorageSpec.md (which is authoritative for this project)
- Pitfalls: HIGH — foreign keys per-connection requirement from official SQLite docs; ESM/CJS interop from TypeScript PR research; native addon build issue from GitHub issues
- Code examples: HIGH — API shapes verified against DefinitelyTyped type definitions

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (better-sqlite3 is stable; TypeScript interop patterns are stable)
