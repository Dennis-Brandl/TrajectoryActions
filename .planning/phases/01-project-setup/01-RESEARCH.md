# Phase 1: Project Setup - Research

**Researched:** 2026-02-25
**Domain:** npm workspaces monorepo, TypeScript 5, Vite 6/7, Express 5, Vitest 4, dev tooling
**Confidence:** HIGH (verified against official docs and Context7)

---

## Summary

This phase establishes a TypeScript monorepo with four Node.js packages (`packages/server`, `packages/engine`, `packages/storage`, `apps/console`) and a non-Node Python sidecar (`python/`). The standard approach in 2026 for this stack is npm workspaces for package linking combined with TypeScript project references for type-safe incremental builds.

The ecosystem has converged on a clear stack: npm workspaces + TypeScript project references for the monorepo layer, tsx watch for server hot-reload, Vite 6.x (pinned per PROJECT.md) for the React console with a built-in dev proxy, Vitest 4.x at the root with `projects:` configuration for workspace-wide testing, and ESLint 9 flat config + Prettier 3 for linting/formatting. Husky 9 + lint-staged wire pre-commit hooks automatically.

The main decision points for "Claude's Discretion" items are: (1) whether to use `@trajectory/*` scoped package names (recommended — avoids npm registry conflicts and is self-documenting in import paths), (2) TypeScript strictness and module resolution strategy (recommend `NodeNext` + `strict: true`), and (3) whether to include a minimal CI workflow in Phase 1 (recommended — one workflow file costs nothing and pays forward).

**Primary recommendation:** Use npm workspaces + TypeScript project references with scoped `@trajectory/*` package names, `NodeNext` module resolution, and a single root `vitest.config.ts` using the `projects:` array. Include a minimal GitHub Actions CI workflow.

---

## Standard Stack

### Core

| Library        | Version                 | Purpose                                               | Why Standard                                                |
| -------------- | ----------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| npm workspaces | built-in (npm 11.6.2)   | Monorepo package linking                              | Native, zero-config, already installed                      |
| TypeScript     | 5.x (PROJECT.md)        | Type-safe compilation across all packages             | Industry standard                                           |
| tsx            | 4.21.0                  | Run/watch TypeScript directly in Node.js (dev server) | Replaces ts-node + nodemon in one tool; esbuild-based, fast |
| Vite           | 6.x (PROJECT.md pinned) | React SPA build + dev proxy                           | PROJECT.md constraint; still actively maintained            |
| Vitest         | 4.x (latest: 4.0.18)    | Unit testing across workspace                         | Vite-native; requires Vite >=6; fast                        |
| ESLint         | 9.x (latest: 9.39.3)    | Linting; flat config is now default                   | ESLint 10 exists but 9 is mature and stable                 |
| Prettier       | 3.x (latest: 3.8.1)     | Code formatting                                       | Industry standard                                           |
| concurrently   | 9.x (latest: 9.2.1)     | Run server + Vite in parallel during dev              | Simple, reliable, no orchestration framework needed         |
| husky          | 9.x                     | Git pre-commit hook management                        | `npx husky init` is one command                             |
| lint-staged    | latest                  | Run linter/formatter only on staged files             | Pairs with husky; fast commits                              |

### Supporting

| Library                | Version      | Purpose                                           | When to Use                     |
| ---------------------- | ------------ | ------------------------------------------------- | ------------------------------- |
| @types/node            | 20.x         | Node.js type definitions                          | All server-side packages        |
| @types/express         | 5.x          | Express type definitions                          | packages/server                 |
| @eslint/js             | 9.x          | ESLint base rules                                 | Included with flat config setup |
| typescript-eslint      | 8.x (8.56.1) | TypeScript-aware linting rules                    | Required for TS + ESLint        |
| eslint-config-prettier | latest       | Disables ESLint rules that conflict with Prettier | Used in ESLint flat config      |
| @vitejs/plugin-react   | latest       | Vite plugin for React JSX transform               | apps/console                    |

### Alternatives Considered

| Instead of                     | Could Use                          | Tradeoff                                                                          |
| ------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------- |
| npm workspaces                 | pnpm workspaces, yarn workspaces   | PROJECT.md implies npm; no reason to deviate                                      |
| tsx                            | ts-node-dev, nodemon + tsc --watch | tsx is simpler (one dependency), faster (esbuild), actively maintained            |
| concurrently                   | npm-run-all2, turborepo            | concurrently is sufficient here; turborepo adds complexity Phase 1 doesn't need   |
| Vitest 4 workspace `projects:` | `defineWorkspace`                  | `defineWorkspace` / `vitest.workspace.ts` deprecated in Vitest 3.2+               |
| ESLint 9 flat config           | ESLint 8 legacy config             | ESLint 10 exists; ESLint 9 is mature and broadly compatible with plugin ecosystem |

### Installation (root devDependencies)

```bash
npm install --save-dev typescript tsx concurrently husky lint-staged \
  eslint @eslint/js typescript-eslint eslint-config-prettier prettier \
  vitest @vitest/coverage-v8
```

---

## Architecture Patterns

### Recommended Project Structure

```
Trajectory-action-container/
├── .github/
│   └── workflows/
│       └── ci.yml                  # CI: install, build, test
├── .husky/
│   └── pre-commit                  # Runs lint-staged
├── apps/
│   └── console/                    # React SPA — Vite project
│       ├── src/
│       ├── index.html
│       ├── vite.config.ts          # Server proxy config lives here
│       ├── tsconfig.json           # Extends ../../tsconfig.base.json
│       └── package.json            # name: "@trajectory/console"
├── packages/
│   ├── server/
│   │   ├── src/index.ts
│   │   ├── tsconfig.json           # Extends ../../tsconfig.base.json
│   │   └── package.json            # name: "@trajectory/server"
│   ├── engine/
│   │   ├── src/index.ts
│   │   ├── tsconfig.json
│   │   └── package.json            # name: "@trajectory/engine"
│   └── storage/
│       ├── src/index.ts
│       ├── tsconfig.json
│       └── package.json            # name: "@trajectory/storage"
├── python/                         # Not a Node workspace; plain Python
│   ├── sandbox_runner.py
│   ├── sandbox_policy.py
│   └── requirements.txt
├── eslint.config.mjs               # Root ESLint flat config (shared)
├── .prettierrc.json
├── package.json                    # Root workspace config + scripts
├── tsconfig.base.json              # Shared TypeScript base
├── tsconfig.json                   # Root references config (for tsc --build)
└── vitest.config.ts                # Root Vitest config with projects:
```

### Pattern 1: npm Workspaces + Scoped Package Names

**What:** Root `package.json` declares `workspaces: ["packages/*", "apps/*"]`. Each package is named `@trajectory/<name>`. npm symlinks them into root `node_modules/@trajectory/`.

**Why scoped names:** Prevents conflicts with public registry packages; import paths like `import { ... } from '@trajectory/engine'` are self-documenting and resolve correctly without path aliases.

**Root package.json:**

```json
{
  "name": "Trajectory-action-container",
  "version": "0.0.1",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "tsc --build",
    "dev": "concurrently --kill-others-on-fail \"npm run dev:server\" \"npm run dev:console\"",
    "dev:server": "tsx watch packages/server/src/index.ts",
    "dev:console": "npm run dev --workspace=apps/console",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "concurrently": "^9.2.1",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "eslint-config-prettier": "latest",
    "husky": "^9.0.0",
    "lint-staged": "latest",
    "prettier": "^3.8.1",
    "typescript": "^5.0.0",
    "tsx": "^4.21.0",
    "vitest": "^4.0.0"
  }
}
```

**Note:** `python/` is NOT listed in workspaces. It is not a Node.js package. It lives at the repo root as a plain directory.

### Pattern 2: TypeScript Project References

**What:** Each package has its own `tsconfig.json` that extends `tsconfig.base.json`. The root `tsconfig.json` lists all packages as `references`. Run `tsc --build` to compile all packages in dependency order.

**When to use:** With `composite: true` and `declarationMap: true`, TypeScript can type-check cross-package imports and support "Go to Definition" navigating to source `.ts` files rather than compiled `.d.ts` stubs.

**tsconfig.base.json (shared settings):**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

**Root tsconfig.json (references only — no compilerOptions):**

```json
{
  "files": [],
  "references": [
    { "path": "./packages/storage" },
    { "path": "./packages/engine" },
    { "path": "./packages/server" },
    { "path": "./apps/console" }
  ]
}
```

**Per-package tsconfig.json example (packages/engine):**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "references": [{ "path": "../storage" }],
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**apps/console/tsconfig.json (React/Vite — different module settings):**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

**Important:** The console uses `"module": "ESNext"` with `"moduleResolution": "Bundler"` because Vite handles bundling — it should NOT use `NodeNext` module resolution.

### Pattern 3: Cross-Package Resolution Without Build Step

**What:** For `tsx watch` to run `packages/server/src/index.ts` and resolve `@trajectory/engine` at runtime (without building), each workspace package's `package.json` must expose its TypeScript source directly.

**How:** Use the `exports` field with a conditional pointing to `./src/index.ts` for development:

**packages/engine/package.json:**

```json
{
  "name": "@trajectory/engine",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

**Note:** With `tsx watch`, tsx uses esbuild to resolve TypeScript files directly from the workspace symlink — it does NOT require built `.js` files. The workspace symlink in `node_modules/@trajectory/engine` points to `packages/engine/`, so tsx can resolve `./src/index.ts` via the package root. This is a key advantage of tsx over plain `node --watch`.

### Pattern 4: Vite Dev Proxy

**What:** The console Vite dev server (port 5173) proxies all requests starting with `/trajectory/` and `/management/` to the Express server at port 3001.

**apps/console/vite.config.ts:**

```typescript
// Source: https://vite.dev/config/server-options
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/trajectory': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/management': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
```

**No path rewriting needed:** The API paths stay as-is — both the console and the Express server use the same `/trajectory/v1/` and `/management/v1/` path prefixes. No `rewrite` function required.

### Pattern 5: Vitest Workspace Root Config

**What:** Root `vitest.config.ts` uses the `projects:` array (not the deprecated `defineWorkspace`). Each package gets its own Vitest config for environment-specific settings.

**Root vitest.config.ts:**

```typescript
// Source: https://vitest.dev/guide/projects
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
```

**Per-package vitest.config.ts (packages/storage):**

```typescript
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'storage',
    environment: 'node',
  },
})
```

**apps/console vitest.config.ts:**

```typescript
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'console',
    environment: 'jsdom',
  },
})
```

**Key:** Use `defineProject` (not `defineConfig`) in per-package configs. All project names must be unique — Vitest throws if two projects share a name.

### Pattern 6: ESLint Flat Config (Root)

**What:** Single `eslint.config.mjs` at the root covering all TypeScript files across packages.

```javascript
// Source: https://typescript-eslint.io/getting-started/
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts'],
  }
)
```

### Pattern 7: Husky + lint-staged Pre-commit

**Setup commands (run once):**

```bash
npx husky init
```

**.husky/pre-commit:**

```sh
npx lint-staged
```

**Root package.json lint-staged config:**

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yml,yaml}": ["prettier --write"]
  }
}
```

### Pattern 8: concurrently Dev Script

**What:** `npm run dev` runs both the Express server (tsx watch) and the Vite console dev server together.

```bash
# In root package.json scripts:
"dev": "concurrently --kill-others-on-fail --names \"server,console\" \"npm run dev:server\" \"npm run dev:console\"",
"dev:server": "tsx watch packages/server/src/index.ts",
"dev:console": "npm run dev --workspace=apps/console",
```

`--kill-others-on-fail` ensures that if the server crashes, the Vite process is also terminated — preventing orphaned processes.

### Pattern 9: GitHub Actions CI (Minimal)

**What:** A single workflow that installs, builds, and tests on every push. Worth including in Phase 1 — it is a one-time setup and validates the workspace configuration end-to-end.

**.github/workflows/ci.yml:**

```yaml
# Source: https://docs.github.com/en/actions/use-cases-and-examples/building-and-testing/building-and-testing-nodejs
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm run lint
```

### Anti-Patterns to Avoid

- **Root-level `paths` in tsconfig.base.json:** TypeScript does not merge `paths` — per-package tsconfigs that define their own `paths` will completely overwrite any root-level `paths`. Don't put `paths` in the base config.
- **`noEmit: true` in server/engine/storage packages:** These packages need `.d.ts` files emitted for cross-package type references. Only the console should use `noEmit: true` (Vite handles bundling).
- **`"type": "module"` mismatches:** If root `package.json` does not set `"type": "module"`, each package should set it explicitly. Inconsistency causes runtime import errors. Align all Node packages to ESM via `"type": "module"`.
- **Running `tsc --watch` + nodemon separately:** Unnecessary complexity. `tsx watch` handles both transpilation and restart.
- **`vitest.workspace.ts` with `defineWorkspace`:** Deprecated since Vitest 3.2. Use `vitest.config.ts` with `test.projects:` instead.

---

## Don't Hand-Roll

| Problem                                    | Don't Build                          | Use Instead                         | Why                                                                          |
| ------------------------------------------ | ------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------- |
| Run multiple dev commands                  | Custom shell script                  | concurrently                        | Process management, signal handling, colored output, `--kill-others-on-fail` |
| Hot-reload TypeScript server               | tsc --watch + nodemon combo          | tsx watch                           | One dependency, faster (esbuild), handles ESM/CJS correctly                  |
| Pre-commit hooks                           | .git/hooks/pre-commit manually       | husky                               | Team-portable; `prepare` script auto-installs on `npm install`               |
| Stage-only linting                         | Run ESLint on all files              | lint-staged                         | Only lints staged files; dramatically faster on large repos                  |
| TypeScript path resolution across packages | `paths` aliases in tsconfig          | npm workspaces + package references | Workspace symlinks + project references are the TypeScript-blessed approach  |
| Per-package test runs                      | `npm test --workspace=X` per CI step | Vitest root `projects:` config      | Single process, parallel execution, unified coverage report                  |
| Proxy API calls in dev                     | Custom Express middleware in Vite    | Vite `server.proxy`                 | Built into Vite; zero runtime code                                           |

**Key insight:** This phase is entirely about wiring standard tools together — not building anything custom. Every listed problem has a maintained, correct solution. Custom alternatives inevitably miss edge cases (signal handling, Windows paths, module resolution edge cases).

---

## Common Pitfalls

### Pitfall 1: Module Resolution Mismatch (NodeNext vs Bundler)

**What goes wrong:** Using `"moduleResolution": "NodeNext"` in the console's tsconfig causes TypeScript to reject bare specifiers without `.js` extensions. Vite uses its own bundler resolution (no extensions needed).

**Why it happens:** `NodeNext` resolution enforces Node.js ESM rules (explicit `.js` extensions in imports). Vite bypasses this with its own resolver.

**How to avoid:** Use `"moduleResolution": "Bundler"` only in `apps/console/tsconfig.json`. Use `"moduleResolution": "NodeNext"` in all `packages/` tsconfigs.

**Warning signs:** TypeScript errors like "An import path cannot end with a '.ts' extension" or "Relative import paths need explicit file extensions in EcmaScript imports."

### Pitfall 2: tsx Watch Fails to Resolve Workspace Packages

**What goes wrong:** `tsx watch packages/server/src/index.ts` throws `Cannot find module '@trajectory/engine'` at runtime.

**Why it happens:** tsx resolves via Node.js module resolution. If workspace packages haven't been linked (i.e., `npm install` was never run), the symlinks don't exist in `node_modules/@trajectory/`.

**How to avoid:** Always run `npm install` at the root before `npm run dev`. The `prepare` script (husky init) and workspace linking both happen during install. Document this in the root README.

**Warning signs:** `MODULE_NOT_FOUND` errors at runtime when starting the dev server.

### Pitfall 3: Composite Packages Require Build Before tsc --build

**What goes wrong:** `tsc --build` fails because a referenced package's `.d.ts` output doesn't exist yet (first-time build).

**Why it happens:** Project references read from `dist/` — they need a prior build to exist. On a fresh clone, `dist/` is empty or absent.

**How to avoid:** `tsc --build` handles this correctly — it builds packages in dependency order. Run `tsc --build` (not `tsc`) from the root. Ensure `"outDir"` and `"rootDir"` are correctly set in each package tsconfig.

**Warning signs:** Error "Referenced project may not disable emit." This means `noEmit: true` is set on a package that is referenced by another.

### Pitfall 4: Vite Proxy Only Works in Dev Mode

**What goes wrong:** After running `npm run build`, the console can no longer reach the API — API calls return 404 or fail.

**Why it happens:** `server.proxy` in `vite.config.ts` is a dev-only feature. It is completely absent from the production build. In production, the Express server serves the static console files directly, so no proxy is needed.

**How to avoid:** Understand the two modes: dev (separate servers, proxy) vs. production (single server, static files). For Phase 1 this is fine — just document it so future phases know to configure Express to serve the console build as static files.

**Warning signs:** API calls fail in `npm run build` + `npm start` mode but work in `npm run dev`.

### Pitfall 5: Husky Hooks Not Installed on Clone

**What goes wrong:** Team members clone the repo and commit without lint-staged running — hooks are silently skipped.

**Why it happens:** `.husky/` scripts exist but Git hooks must be installed via `husky install`. Without the `prepare` script, new clones skip this.

**How to avoid:** `npx husky init` automatically adds `"prepare": "husky"` to root `package.json`. This ensures `npm install` always installs hooks. Verify `prepare` is in `package.json` after setup.

**Warning signs:** Pre-commit hook not running. Check with `cat .git/hooks/pre-commit`.

### Pitfall 6: Python Sidecar Listed as npm Workspace

**What goes wrong:** If `python/` is listed in `workspaces: ["packages/*", "apps/*", "python/"]`, npm looks for a `package.json` in `python/` and fails if none exists.

**Why it happens:** npm workspaces requires a valid `package.json` in every listed workspace directory.

**How to avoid:** Do NOT list `python/` as a workspace. The Python sidecar is managed independently — it is invoked via `child_process.spawn` by the engine. No `package.json` needed.

**Warning signs:** `npm install` error about missing `package.json` in workspace.

### Pitfall 7: Vitest Project Name Conflicts

**What goes wrong:** Two packages both have no Vitest config (or both return `name: undefined`), causing Vitest to throw "All projects must have unique names."

**Why it happens:** When using glob patterns like `packages/*`, Vitest tries to infer project names. Without explicit names, conflicts arise.

**How to avoid:** Add a `vitest.config.ts` with `defineProject({ test: { name: 'package-name' } })` to every package that has tests.

**Warning signs:** Vitest startup error mentioning duplicate project names.

---

## Code Examples

Verified patterns from official sources:

### Root package.json workspaces declaration

```json
{
  "name": "Trajectory-action-container",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "tsc --build",
    "dev": "concurrently --kill-others-on-fail --names \"server,console\" \"npm run dev:server\" \"npm run dev:console\"",
    "dev:server": "tsx watch packages/server/src/index.ts",
    "dev:console": "npm run dev --workspace=apps/console",
    "test": "vitest run",
    "lint": "eslint .",
    "format": "prettier --write .",
    "prepare": "husky"
  }
}
```

### Workspace package package.json (packages/engine)

```json
{
  "name": "@trajectory/engine",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc --build",
    "dev": "tsc --build --watch"
  },
  "dependencies": {
    "@trajectory/storage": "*"
  }
}
```

**Note:** `"@trajectory/storage": "*"` causes npm to link to the local workspace package.

### packages/server/src/index.ts stub (Express 5)

```typescript
// Source: https://www.reactsquad.io/blog/how-to-set-up-express-5-in-2025
import express from 'express'

const app = express()
const port = Number(process.env.PORT ?? 3001)

app.use(express.json())

app.get('/trajectory/v1/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})
```

### apps/console/vite.config.ts with proxy

```typescript
// Source: https://vite.dev/config/server-options
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/trajectory': { target: 'http://localhost:3001', changeOrigin: true },
      '/management': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
```

### Root vitest.config.ts

```typescript
// Source: https://vitest.dev/guide/projects
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
```

### eslint.config.mjs (flat config)

```javascript
// Source: https://typescript-eslint.io/getting-started/
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts', 'python/**'],
  }
)
```

### .prettierrc.json

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

### Husky setup (one-time)

```bash
# Run from repo root after npm install
npx husky init
# Edit .husky/pre-commit to contain:
# npx lint-staged
```

---

## State of the Art

| Old Approach                                    | Current Approach                      | When Changed               | Impact                                                             |
| ----------------------------------------------- | ------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `ts-node` + `nodemon` for server dev            | `tsx watch`                           | ~2023                      | One dependency; esbuild speed; handles ESM correctly               |
| `vitest.workspace.ts` + `defineWorkspace`       | `vitest.config.ts` + `test.projects:` | Vitest 3.2                 | Old API deprecated but still works; new API is cleaner             |
| ESLint `.eslintrc.js` (legacy config)           | `eslint.config.mjs` (flat config)     | ESLint 9.0                 | Flat config is now the default; legacy config removed in ESLint 10 |
| `npm install --save-dev husky && husky install` | `npx husky init`                      | Husky v9                   | Single command sets up everything including `prepare` script       |
| Path aliases in tsconfig `paths`                | npm workspaces + package exports      | ~2022                      | Path aliases break IDE navigation; workspace symlinks are correct  |
| `tsc --watch` per package                       | `tsc --build` at root                 | TypeScript 3+ project refs | Correct cross-package build order; incremental                     |
| Vite 5.x                                        | Vite 6.x / 7.x                        | Late 2024 / 2025           | PROJECT.md pins to 6.x — still supported with security backports   |

**Deprecated/outdated:**

- `vitest.workspace.ts` / `defineWorkspace`: Deprecated since Vitest 3.2; use `test.projects:` in `vitest.config.ts` instead.
- ESLint `.eslintrc.*` files: Removed in ESLint 10; use flat config (`eslint.config.mjs`) from the start.
- `ts-node`: Superseded by `tsx` for most use cases; `tsx` is faster and handles ESM natively.

---

## Open Questions

1. **Vite 6 vs Vite 7 pin**
   - What we know: PROJECT.md specifies Vite 6.x. Vite 7 is current (7.3.1). Vite 6 has backported security fixes (6.4+).
   - What's unclear: Whether any Vitest 4 features require Vite 7 specifically.
   - Recommendation: Pin to `vite@6` in `apps/console/package.json` as specified by PROJECT.md. Pin `vitest@4` at root. Both remain compatible.

2. **`"type": "module"` vs CommonJS for server packages**
   - What we know: `tsx watch` works with both. `"module": "NodeNext"` in tsconfig requires explicit `.js` extensions in imports. `"type": "module"` in package.json makes all `.js` files ESM.
   - What's unclear: Whether better-sqlite3 (used in Phase 2+) has any ESM/CJS issues.
   - Recommendation: Set `"type": "module"` in all `packages/` package.json files for consistency with the `NodeNext` module resolution strategy. If better-sqlite3 causes issues, it can be worked around with `createRequire`.

3. **`packages/python-sidecar/` vs `python/` directory name**
   - What we know: CONTEXT.md says "Python sidecar lives in its own package (packages/python-sidecar/)". ArchitectureSpec.md shows it as `python/` at the repo root.
   - What's unclear: Whether the CONTEXT.md decision to put it in `packages/python-sidecar/` overrides ArchitectureSpec.md's `python/` root location.
   - Recommendation: Follow CONTEXT.md (locked decision) — place it at `packages/python-sidecar/`. Do NOT add it to npm workspaces since it has no `package.json`. The path difference only affects how the engine spawns the subprocess — just update the spawn path accordingly.

---

## Sources

### Primary (HIGH confidence)

- [Vitest Guide - Projects](https://vitest.dev/guide/projects) — `projects:` config syntax verified
- [Vite Server Options](https://vite.dev/config/server-options) — `server.proxy` configuration
- [typescript-eslint Getting Started](https://typescript-eslint.io/getting-started/) — ESLint flat config setup; version 8.56.1
- [Husky Get Started](https://typicode.github.io/husky/get-started.html) — `npx husky init` command; version 9.0.1
- [GitHub Actions - Building and Testing Node.js](https://docs.github.com/en/actions/use-cases-and-examples/building-and-testing/building-and-testing-nodejs) — CI workflow template
- [Express 5 Setup 2025](https://www.reactsquad.io/blog/how-to-set-up-express-5-in-2025) — NodeNext + tsx watch pattern; `"type": "module"`

### Secondary (MEDIUM confidence)

- [Vite Guide](https://vite.dev/guide/) — Current Vite version (7.3.1); Node.js 20.19+ requirement
- [tsx Watch Mode](https://tsx.is/watch-mode) — Watch mode flags and auto-exclusion of node_modules
- [npm Workspaces Docs](https://docs.npmjs.com/cli/v8/using-npm/workspaces/) — workspace glob pattern behavior
- [Live Types in TypeScript Monorepos](https://colinhacks.com/essays/live-types-typescript-monorepo) — custom conditions for source resolution

### Tertiary (LOW confidence — WebSearch, verify if needed)

- concurrently version 9.2.1 — from WebSearch; `--kill-others-on-fail` flag
- tsx version 4.21.0 — from WebSearch
- ESLint latest 9.x version (9.39.3) — from WebSearch
- Prettier latest 3.x version (3.8.1) — from WebSearch

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — Verified via official docs and Context7; versions confirmed via npm
- Architecture: HIGH — Patterns follow official documentation for npm workspaces + TypeScript project references
- Pitfalls: MEDIUM — Some from official docs, some from community experience; all plausible and actionable
- CI workflow: HIGH — Directly from GitHub Actions official documentation

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (30 days — stable ecosystem; Vite 6/Vitest 4 are major versions with stable APIs)
