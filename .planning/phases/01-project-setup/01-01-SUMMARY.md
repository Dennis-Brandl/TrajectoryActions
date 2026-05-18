---
phase: 01-project-setup
plan: 01
subsystem: infra
tags: [npm-workspaces, typescript, vitest, monorepo, react, vite]

requires:
  - phase: none
    provides: first phase — no prior phases

provides:
  - npm workspaces monorepo with four linked TypeScript packages
  - Shared tsconfig.base.json with strict NodeNext module resolution
  - Root tsconfig.json with project references for tsc --build
  - Vitest workspace config discovering all four test projects
  - Python sidecar placeholder directory (not an npm workspace)
  - .gitignore covering all generated artifacts

affects: [all subsequent phases — every package builds on this scaffold]

tech-stack:
  added:
    - typescript@^5.0.0 (root devDependency)
    - vitest@^4.0.0 (root devDependency)
    - "@vitest/coverage-v8@latest" (root devDependency)
    - react@^19.0.0 (apps/console dependency)
    - react-dom@^19.0.0 (apps/console dependency)
    - "@vitejs/plugin-react@^4.0.0" (apps/console devDependency)
    - vite@^6.0.0 (apps/console devDependency)
    - "@types/react@^19.0.0" (apps/console devDependency)
    - "@types/react-dom@^19.0.0" (apps/console devDependency)
    - "@types/node@^20.0.0" (packages/server devDependency)
  patterns:
    - npm workspaces with scoped @trajectory/* package names
    - TypeScript project references for incremental cross-package builds
    - defineProject (not defineConfig) in per-package vitest configs
    - NodeNext module resolution for server packages, Bundler for console
    - composite: true on all Node packages for tsc --build support

key-files:
  created:
    - package.json (root workspace config)
    - tsconfig.base.json (shared TypeScript compiler options)
    - tsconfig.json (root project references)
    - vitest.config.ts (workspace test discovery)
    - .gitignore (all artifact patterns)
    - .prettierignore (formatter exclusions)
    - package-lock.json (lockfile)
    - packages/storage/package.json
    - packages/storage/tsconfig.json
    - packages/storage/src/index.ts
    - packages/storage/vitest.config.ts
    - packages/engine/package.json
    - packages/engine/tsconfig.json
    - packages/engine/src/index.ts
    - packages/engine/vitest.config.ts
    - packages/server/package.json
    - packages/server/tsconfig.json
    - packages/server/src/index.ts
    - packages/server/vitest.config.ts
    - apps/console/package.json
    - apps/console/tsconfig.json
    - apps/console/tsconfig.node.json
    - apps/console/index.html
    - apps/console/src/main.tsx
    - apps/console/src/App.tsx
    - apps/console/src/vite-env.d.ts
    - apps/console/vitest.config.ts
    - packages/python-sidecar/requirements.txt
    - packages/python-sidecar/sandbox_runner.py
  modified: []

key-decisions:
  - "vitest.config.ts uses explicit package paths (not glob) to exclude packages/python-sidecar from test discovery"
  - "packages/python-sidecar has no package.json and is not listed in npm workspaces — it is a plain Python directory"
  - "apps/console uses Bundler moduleResolution and verbatimModuleSyntax: false to work with Vite; server packages use NodeNext"

patterns-established:
  - "Cross-package dependency: @trajectory/engine imports from @trajectory/storage via workspace symlink"
  - "TypeScript project references: each composite package references its dependencies for incremental builds"
  - "Per-package vitest configs use defineProject with unique name and environment"

duration: 4min
completed: 2026-02-25
---

# Phase 1 Plan 1: Monorepo Scaffold Summary

**npm workspaces monorepo with four @trajectory/\* TypeScript packages, composite project references, and Vitest workspace config — all compiling and test-discoverable from root.**

## Performance

- **Duration:** 4min
- **Started:** 2026-02-25T15:10:04Z
- **Completed:** 2026-02-25T15:14:12Z
- **Tasks:** 2
- **Files modified:** 30

## Accomplishments

- Root npm workspace config links four @trajectory/\* packages via node_modules/@trajectory/ symlinks
- TypeScript project reference chain (storage → engine → server) compiles cleanly with `tsc --build` producing .d.ts files for cross-package type resolution
- Vitest discovers exactly 4 test projects (storage, engine, server, console) with correct environments (node/node/node/jsdom)
- apps/console React 19 + Vite 6 SPA with correct Bundler module resolution (not NodeNext) for JSX support
- packages/python-sidecar exists as a plain Python directory with no package.json, correctly excluded from npm workspaces and Vitest

## Task Commits

1. **Task 1: Create root workspace config and shared TypeScript base** - `99f57b8` (chore)
2. **Task 2: Create all workspace packages with tsconfigs and stub source files** - `ecb5ba4` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `package.json` - Root workspace config: workspaces, scripts (build/test/test:watch), TypeScript/Vitest devDependencies
- `tsconfig.base.json` - Shared compiler options: strict, NodeNext, composite-ready, declaration/sourceMap output
- `tsconfig.json` - Root project references only (no compilerOptions) pointing to all 4 packages
- `vitest.config.ts` - Explicit project list (storage, engine, server, console) excluding python-sidecar
- `.gitignore` - node*modules, dist, *.tsbuildinfo, .env, coverage, SQLite files, Python artifacts, ~$\_ temp files
- `.prettierignore` - dist, node_modules, coverage, \*.db, packages/python-sidecar
- `packages/storage/` - @trajectory/storage stub with STORAGE_VERSION export, composite tsconfig, node vitest config
- `packages/engine/` - @trajectory/engine stub importing STORAGE_VERSION, composite tsconfig with storage reference
- `packages/server/` - @trajectory/server stub importing ENGINE_VERSION, composite tsconfig with engine reference, @types/node
- `apps/console/` - React 19 + Vite 6 SPA with Bundler module resolution, JSX, index.html, main.tsx, App.tsx stubs
- `packages/python-sidecar/` - requirements.txt and sandbox_runner.py placeholders (no package.json)

## Decisions Made

**vitest.config.ts uses explicit paths instead of glob `packages/*`:** When the root vitest.config.ts used `'packages/*'`, Vitest picked up `packages/python-sidecar` as a 5th project (since it matched the glob). Switched to explicit paths (`packages/storage`, `packages/engine`, `packages/server`, `apps/console`) to discover exactly 4 projects as required by the plan.

**apps/console tsconfig verbatimModuleSyntax: false:** The console overrides `verbatimModuleSyntax` from the base (which sets it to true) because Vite's Bundler module resolution doesn't require type-only import prefixes. This prevents spurious TS errors in JSX files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vitest.config.ts glob `packages/*` picked up python-sidecar as 5th project**

- **Found during:** Task 2 verification (vitest run showed 5 projects instead of 4)
- **Issue:** Root vitest.config.ts used `'packages/*'` glob which matched packages/python-sidecar, causing Vitest to discover it as a project named "python-sidecar"
- **Fix:** Changed vitest.config.ts from glob patterns to explicit package paths: `packages/storage`, `packages/engine`, `packages/server`, `apps/console`
- **Files modified:** `vitest.config.ts`
- **Commit:** Included in `ecb5ba4`

## Issues Encountered

None beyond the glob deviation above, which was fixed inline.

## Next Phase Readiness

Phase 1 Plan 2 (01-02-PLAN.md — Dev tooling) can proceed immediately:

- Express 5 server stub with health endpoint (packages/server/src/index.ts is the target)
- Vite dev proxy configuration (apps/console needs vite.config.ts created)
- ESLint + Prettier configuration (root)
- Husky + lint-staged pre-commit hooks
- concurrently dev script
- GitHub Actions CI workflow

All package scaffolding is in place. `npm install` links workspaces. `tsc --build` compiles. Vitest discovers 4 projects.

---

_Phase: 01-project-setup_
_Completed: 2026-02-25_
