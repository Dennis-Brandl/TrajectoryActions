---
phase: 01-project-setup
plan: 02
subsystem: infra
tags: [express5, vite-proxy, eslint, prettier, husky, lint-staged, github-actions, ci, concurrently, tsx]

requires:
  - phase: 01-project-setup plan 01
    provides: monorepo scaffold with packages, tsconfigs, vitest

provides:
  - Express 5 dev server stub with /trajectory/v1/health endpoint on port 3001
  - Vite dev proxy forwarding /trajectory/* and /management/* to localhost:3001
  - Single-command dev startup via concurrently (npm run dev)
  - ESLint flat config with typescript-eslint and eslint-config-prettier
  - Prettier config (no semi, single quotes, 100 print width)
  - Husky pre-commit hook running lint-staged on staged files
  - GitHub Actions CI workflow (build, test, lint, format:check on main branch)

affects: [all subsequent phases - dev tooling used throughout, CI validates every push]

tech-stack:
  added:
    - express@5 (packages/server dependency)
    - "@types/express@5" (packages/server devDependency)
    - concurrently@^9.2.1 (root devDependency)
    - tsx@^4.21.0 (root devDependency)
    - eslint@^10.0.2 (root devDependency)
    - "@eslint/js@^10.0.1" (root devDependency)
    - typescript-eslint@^8.56.1 (root devDependency)
    - eslint-config-prettier@^10.1.8 (root devDependency)
    - prettier@^3.8.1 (root devDependency)
    - husky@^9.1.7 (root devDependency)
    - lint-staged@^16.2.7 (root devDependency)
  patterns:
    - Express 5 self-contained entry point (no export default) with ESM type module
    - Vite proxy config for API forwarding to Express backend on different port
    - ESLint flat config (eslint.config.mjs) with typescript-eslint recommended rules
    - lint-staged runs eslint --fix + prettier --write on staged TypeScript files

key-files:
  created:
    - apps/console/vite.config.ts (React plugin + /trajectory and /management proxy)
    - eslint.config.mjs (flat config with typescript-eslint + prettier compat)
    - .prettierrc.json (no semi, single quotes, trailingComma es5, printWidth 100)
    - .husky/pre-commit (runs npx lint-staged)
    - .github/workflows/ci.yml (build + test + lint + format:check on main)
  modified:
    - packages/server/src/index.ts (replaced stub with Express 5 health endpoint)
    - package.json (added dev/dev:server/dev:console/lint/format/prepare scripts, lint-staged config)
    - package-lock.json (updated with new dependencies)
    - packages/engine/src/index.ts (fixed unused import — uses STORAGE_VERSION in ENGINE_VERSION)

key-decisions:
  - "Express 5 server is a self-contained entry point (no export default) to work with tsx watch"
  - "packages/engine/src/index.ts ENGINE_VERSION incorporates STORAGE_VERSION to satisfy ESLint no-unused-vars"
  - "ESLint flat config (eslint.config.mjs) chosen over legacy .eslintrc for ESLint 10 compatibility"

patterns-established:
  - "Dev proxy: Vite /trajectory/* and /management/* proxy to Express on :3001, enabling single-origin frontend API calls"
  - "Pre-commit quality gate: husky -> lint-staged -> eslint --fix + prettier --write on staged TypeScript files"
  - "CI pipeline: npm ci, build, test, lint, format:check run on every push to main"

duration: 4min
completed: 2026-02-25
---

# Phase 1 Plan 2: Dev Tooling Summary

**Full dev toolchain wired up: Express 5 health endpoint on :3001, Vite proxy config, ESLint/Prettier flat config, husky pre-commit with lint-staged, and GitHub Actions CI — all verified working.**

## Performance

- **Duration:** 4min
- **Started:** 2026-02-25T15:17:30Z
- **Completed:** 2026-02-25T15:21:52Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- `npm run dev` starts Express 5 on :3001 (tsx watch) + Vite on :5173 (with /trajectory and /management proxy) concurrently with color-coded output
- Code quality enforced on every commit: ESLint flat config with typescript-eslint recommended + Prettier via husky pre-commit hook running lint-staged

## Task Commits

1. **Task 1: Express dev server stub, Vite proxy, and dev scripts** - `f979fdf` (feat)
2. **Task 2: ESLint, Prettier, husky, lint-staged, and GitHub Actions CI** - `27e2734` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `packages/server/src/index.ts` - Express 5 app with express.json() middleware and GET /trajectory/v1/health returning { status, timestamp }
- `apps/console/vite.config.ts` - Vite config with @vitejs/plugin-react and proxy rules for /trajectory/_ and /management/_ to http://localhost:3001
- `package.json` - Added dev/dev:server/dev:console/lint/lint:fix/format/format:check/prepare scripts; lint-staged config block
- `eslint.config.mjs` - ESLint 10 flat config: @eslint/js recommended + typescript-eslint recommended + eslint-config-prettier; ignores dist/node_modules/d.ts/python-sidecar
- `.prettierrc.json` - Prettier: semi:false, singleQuote:true, trailingComma:es5, printWidth:100, tabWidth:2
- `.husky/pre-commit` - Runs `npx lint-staged` on staged files before each commit
- `.github/workflows/ci.yml` - GitHub Actions CI: Node 20, npm ci, build, test, lint, format:check on push/PR to main
- `packages/engine/src/index.ts` - Fixed: ENGINE_VERSION now incorporates STORAGE_VERSION to satisfy ESLint no-unused-vars

## Decisions Made

**Express 5 server as self-contained entry point:** The plan specified "Do NOT add export default app" because tsx watch runs the file directly as a module entry point with ESM. Keeping it self-contained avoids the need for a separate runner script.

**ENGINE_VERSION incorporates STORAGE_VERSION:** The engine stub imported `STORAGE_VERSION` but never used it, triggering ESLint `@typescript-eslint/no-unused-vars`. Rather than suppressing the rule, ENGINE_VERSION now references STORAGE_VERSION as part of its value — making the dependency explicit in the output.

**ESLint flat config (eslint.config.mjs):** ESLint 10 defaults to flat config. Using `eslint.config.mjs` ensures forward compatibility and avoids deprecation warnings from legacy `.eslintrc` format.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] packages/engine/src/index.ts had unused STORAGE_VERSION import**

- **Found during:** Task 2 verification (ESLint reported 1 error: 'STORAGE_VERSION' is defined but never used)
- **Issue:** The plan 01-01 stub imported STORAGE_VERSION but only exported ENGINE_VERSION as a string literal, leaving the import unused and violating `@typescript-eslint/no-unused-vars`
- **Fix:** Changed ENGINE_VERSION to incorporate STORAGE_VERSION: `` `${STORAGE_VERSION}-engine-0.0.1` as const ``
- **Files modified:** `packages/engine/src/index.ts`
- **Commit:** Included in `27e2734`

## Issues Encountered

None beyond the ESLint unused import deviation above, which was fixed inline.

## Next Phase Readiness

Phase 1 is complete. Phase 2 (Storage) and Phase 3 (Engine) can both begin immediately in parallel:

- `npm run dev` starts the full dev environment (Express :3001 + Vite :5173)
- `npm run build` compiles all packages via tsc --build project references
- `npm test` discovers all 4 test projects (storage, engine, server, console)
- `npm run lint` and `npm run format:check` enforce code quality
- Pre-commit hook ensures lint + format on every commit
- GitHub Actions CI validates every push to main

---

_Phase: 01-project-setup_
_Completed: 2026-02-25_
