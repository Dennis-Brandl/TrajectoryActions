# Trajectory Action Tester — Plan 1: Vite Scaffold

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a fresh React 19 + Vite 6 + TypeScript-strict project at `C:\TrajectoryActionTester\` with single-file build, vanilla CSS Modules, ESLint flat config, Prettier, Vitest + React Testing Library, and an empty three-pane app shell. The old `C:\ActionContainerTester\` is removed. After this plan, `npm run dev` serves a working empty shell and `npm run build` produces a single-file `dist/index.html`.

**Architecture:** Standalone repo, separate from the Trajectory monorepo. Vite + `vite-plugin-singlefile` for one-HTML output. Dependencies kept lean: React 19, ReactDOM 19, `@tanstack/react-query`, plus dev tooling. No Tailwind, no shadcn — vanilla CSS Modules. Folder skeleton (`api/`, `store/`, `components/`, `features/`, `lib/`) is created with placeholder index files so later plans add to it without restructuring.

**Tech Stack:** Node 20+, React 19, Vite 6, TypeScript 5 strict, `vite-plugin-singlefile`, `@tanstack/react-query` v5, Vitest 3, `@testing-library/react`, ESLint 9 flat config, Prettier 3.

**Spec:** `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md`

---

## File Structure

This plan creates one new project, structured as:

| Path                                                | Role                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `C:\TrajectoryActionTester\package.json`            | Workspace root manifest. React 19 + Vite 6 deps.                           |
| `C:\TrajectoryActionTester\tsconfig.json`           | TS 5 strict config with `verbatimModuleSyntax: false`, bundler resolution. |
| `C:\TrajectoryActionTester\tsconfig.node.json`      | Node-side TS config for `vite.config.ts`.                                  |
| `C:\TrajectoryActionTester\vite.config.ts`          | Vite config with `vite-plugin-singlefile` and Vitest config.               |
| `C:\TrajectoryActionTester\eslint.config.mjs`       | ESLint 9 flat config — TS + React + React Hooks rules.                     |
| `C:\TrajectoryActionTester\.prettierrc.json`        | Prettier config.                                                           |
| `C:\TrajectoryActionTester\.gitignore`              | Standard Node ignores plus `dist/`.                                        |
| `C:\TrajectoryActionTester\index.html`              | Vite entrypoint HTML, loads `src/main.tsx`.                                |
| `C:\TrajectoryActionTester\src\main.tsx`            | React root, mounts `<App />` inside `<QueryClientProvider>`.               |
| `C:\TrajectoryActionTester\src\App.tsx`             | Empty three-pane shell (top bar + LHS + Center + RHS).                     |
| `C:\TrajectoryActionTester\src\App.module.css`      | Shell layout styles using grid.                                            |
| `C:\TrajectoryActionTester\src\theme.css`           | Global dark theme tokens (CSS variables).                                  |
| `C:\TrajectoryActionTester\src\api\.gitkeep`        | Placeholder for plan-2 onward.                                             |
| `C:\TrajectoryActionTester\src\store\.gitkeep`      | Placeholder.                                                               |
| `C:\TrajectoryActionTester\src\components\.gitkeep` | Placeholder.                                                               |
| `C:\TrajectoryActionTester\src\features\.gitkeep`   | Placeholder.                                                               |
| `C:\TrajectoryActionTester\src\lib\.gitkeep`        | Placeholder.                                                               |
| `C:\TrajectoryActionTester\src\App.test.tsx`        | First component test — App renders without crashing.                       |
| `C:\TrajectoryActionTester\src\vitest.setup.ts`     | Vitest setup: registers `@testing-library/jest-dom` matchers.              |
| `C:\TrajectoryActionTester\README.md`               | Setup, dev, build, test commands; project goals.                           |

Old path `C:\ActionContainerTester\` is removed in Task 1 (after backup snapshot).

---

## Pre-flight check

Before starting, confirm Node 20+ is available:

```powershell
node --version
# Expected: v20.x or later
```

If the installed version is older, install Node 20 (or use `nvm` / Volta) before continuing — Vite 6 requires Node 18.18+ but 20+ is the recommended target.

---

## Task 1: Snapshot and remove the old project

**Files:**

- Create: `C:\ActionContainerTester-OLD.zip` (backup snapshot of the predecessor project)
- Delete: `C:\ActionContainerTester\` (directory)

- [x] **Step 1: Inspect what's in the old project**

Run in PowerShell:

```powershell
Get-ChildItem C:\ActionContainerTester -Force
```

Expected output: at least `index.html`, `README.md`, and a `.git` directory. Confirm this is the right path before removing.

- [x] **Step 2: Snapshot the old project as a zip**

```powershell
Compress-Archive -Path C:\ActionContainerTester -DestinationPath C:\ActionContainerTester-OLD.zip -Force
```

Expected: file `C:\ActionContainerTester-OLD.zip` exists. This preserves the predecessor's git history if the user ever wants to recover.

- [x] **Step 3: Verify the snapshot opens**

```powershell
Get-ChildItem C:\ActionContainerTester-OLD.zip | Format-List
```

Expected: file size > 0 bytes.

- [x] **Step 4: Remove the old directory**

```powershell
Remove-Item -Recurse -Force C:\ActionContainerTester
```

Expected: command completes silently. Confirm with `Test-Path C:\ActionContainerTester` → `False`.

- [x] **Step 5: No commit yet**

The new project's git repo doesn't exist yet. Move on to Task 2.

---

## Task 2: Initialize the new project root

**Files:**

- Create: `C:\TrajectoryActionTester\` (directory)
- Create: `C:\TrajectoryActionTester\.gitignore`
- Create: `C:\TrajectoryActionTester\README.md`

- [x] **Step 1: Create the directory**

```powershell
New-Item -ItemType Directory -Path C:\TrajectoryActionTester | Out-Null
Set-Location C:\TrajectoryActionTester
```

Expected: directory created, current working dir is `C:\TrajectoryActionTester`.

- [x] **Step 2: Initialize git**

```powershell
git init -b main
```

Expected: "Initialized empty Git repository in C:/TrajectoryActionTester/.git/" (or similar with `main` as the initial branch).

- [x] **Step 3: Create `.gitignore`**

Write `C:\TrajectoryActionTester\.gitignore`:

```
node_modules/
dist/
.DS_Store
*.log
.vite/
coverage/
.env
.env.local
```

- [x] **Step 4: Create initial README**

Write `C:\TrajectoryActionTester\README.md`:

````markdown
# Trajectory Action Tester

Standalone single-file HTML React app for testing any Trajectory Action Container REST implementation.

## Status

Phase 4-01 scaffold — empty three-pane shell, single-file build pipeline.

## Requirements

- Node 20 or later

## Setup

```bash
npm install
```

## Develop

```bash
npm run dev
```

Opens a Vite dev server on a free port; visit the printed URL.

## Build single-file artifact

```bash
npm run build
```

Produces `dist/index.html` — a single HTML file with all JS and CSS inlined. Open it directly in any browser (no server needed).

## Test

```bash
npm test         # vitest run
npm run lint     # eslint
```

## Spec

`docs/specs/2026-05-11-trajectory-action-tester-v2-design.md` in the Trajectory Action Container monorepo (`C:\TrajectoryActions\`).
````

- [x] **Step 5: Initial commit**

```powershell
git add .gitignore README.md
git commit -m "chore: initial repo scaffold"
```

Expected: commit succeeds. `git log --oneline` shows one commit.

---

## Task 3: Initialize package.json and install dependencies

**Files:**

- Create: `C:\TrajectoryActionTester\package.json`

- [x] **Step 1: Create `package.json` directly (no `npm init` interactive prompt)**

Write `C:\TrajectoryActionTester\package.json`:

```json
{
  "name": "trajectory-action-tester",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Standalone single-file HTML React app for testing any Trajectory Action Container REST implementation.",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "typecheck": "tsc -b --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tanstack/react-query": "^5.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "eslint": "^9.0.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "eslint-plugin-react-refresh": "^0.4.0",
    "jsdom": "^25.0.0",
    "msw": "^2.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.0.0",
    "vite": "^6.0.0",
    "vite-plugin-singlefile": "^2.0.0",
    "vitest": "^3.0.0",
    "@vitest/coverage-v8": "^3.0.0"
  }
}
```

- [x] **Step 2: Install dependencies**

```powershell
npm install
```

Expected: completes without errors. `node_modules/` populates. `package-lock.json` is generated. Some npm warnings about peer-dependency ranges are fine; hard errors are not.

- [x] **Step 3: Verify installed versions match the manifest**

```powershell
npm ls react react-dom vite typescript vitest
```

Expected: React 19.x, Vite 6.x, TypeScript 5.6+, Vitest 3.x.

- [x] **Step 4: Commit**

```powershell
git add package.json package-lock.json
git commit -m "chore: add package.json with React 19 + Vite 6 deps"
```

---

## Task 4: TypeScript configuration

**Files:**

- Create: `C:\TrajectoryActionTester\tsconfig.json`
- Create: `C:\TrajectoryActionTester\tsconfig.app.json`
- Create: `C:\TrajectoryActionTester\tsconfig.node.json`

The split (`tsconfig.json` references `tsconfig.app.json` and `tsconfig.node.json`) is the standard Vite + React pattern. App code uses the bundler resolver; `vite.config.ts` uses Node resolution.

- [x] **Step 1: Write root `tsconfig.json`**

Write `C:\TrajectoryActionTester\tsconfig.json`:

```jsonc
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }],
}
```

- [x] **Step 2: Write `tsconfig.app.json`** (the app side)

Write `C:\TrajectoryActionTester\tsconfig.app.json`:

```jsonc
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "verbatimModuleSyntax": false,

    /* Linting / strict */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,

    /* CSS Modules */
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
  },
  "include": ["src"],
}
```

- [x] **Step 3: Write `tsconfig.node.json`** (the Vite config side)

Write `C:\TrajectoryActionTester\tsconfig.node.json`:

```jsonc
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
  },
  "include": ["vite.config.ts"],
}
```

- [x] **Step 4: Run typecheck to confirm configs parse**

```powershell
npx tsc -b --noEmit
```

Expected: passes with no errors. (At this point there are no source files — `include: ["src"]` matches nothing, so the app config compiles trivially. The Node config will fail until we add `vite.config.ts` in Task 5; that's fine — Task 5 fixes it.)

If it fails: read the error. Common causes are typos in JSON or missing dependencies.

- [x] **Step 5: Commit**

```powershell
git add tsconfig.json tsconfig.app.json tsconfig.node.json
git commit -m "chore: TypeScript strict configuration"
```

---

## Task 5: Vite configuration with single-file plugin

**Files:**

- Create: `C:\TrajectoryActionTester\vite.config.ts`

- [x] **Step 1: Write `vite.config.ts`**

Write `C:\TrajectoryActionTester\vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/vitest.setup.ts'],
    css: {
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
  },
})
```

The Vitest CSS module strategy `non-scoped` makes class names predictable in tests (the actual class name in the imported object equals the CSS file's class name). Without it, scoped class names hash and break selector-based assertions.

`defineConfig` is imported from `'vitest/config'` (not `'vite'`) because Vite's `defineConfig` doesn't know about the Vitest `test` block. `vitest/config` re-exports a `defineConfig` accepting both Vite and Vitest config — single import covers both.

- [x] **Step 2: Run typecheck — both configs now succeed**

```powershell
npx tsc -b --noEmit
```

Expected: passes.

- [x] **Step 3: Commit**

```powershell
git add vite.config.ts
git commit -m "chore: Vite config with vite-plugin-singlefile and Vitest"
```

---

## Task 6: ESLint and Prettier

**Files:**

- Create: `C:\TrajectoryActionTester\eslint.config.mjs`
- Create: `C:\TrajectoryActionTester\.prettierrc.json`
- Create: `C:\TrajectoryActionTester\.prettierignore`

- [x] **Step 1: Write the ESLint flat config**

Write `C:\TrajectoryActionTester\eslint.config.mjs`:

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  }
)
```

- [x] **Step 2: Install the `globals` dep referenced by the ESLint config**

```powershell
npm install --save-dev globals @eslint/js
```

Expected: installs cleanly. The earlier `package.json` already listed the other ESLint plugins; these two are commonly omitted from minimal manifests.

- [x] **Step 3: Write Prettier config**

Write `C:\TrajectoryActionTester\.prettierrc.json`:

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "arrowParens": "always"
}
```

Write `C:\TrajectoryActionTester\.prettierignore`:

```
dist/
node_modules/
coverage/
*.md
```

- [x] **Step 4: Run ESLint — succeeds trivially with no source yet**

```powershell
npm run lint
```

Expected: zero warnings, zero errors (no files to lint yet).

- [x] **Step 5: Commit**

```powershell
git add eslint.config.mjs .prettierrc.json .prettierignore package.json package-lock.json
git commit -m "chore: ESLint flat config + Prettier"
```

---

## Task 7: Theme tokens and global CSS

**Files:**

- Create: `C:\TrajectoryActionTester\src\theme.css`

- [x] **Step 1: Write the global theme CSS**

Write `C:\TrajectoryActionTester\src\theme.css`:

```css
:root {
  /* Background and surfaces */
  --acT-bg: #1e1e1e;
  --acT-panel: #252526;
  --acT-panel-alt: #2d2d30;
  --acT-border: #1e1e1e;
  --acT-divider: #333;

  /* Text */
  --acT-text: #d4d4d4;
  --acT-text-muted: #6e6e6e;
  --acT-text-subtle: #9e9e9e;

  /* Accents */
  --acT-accent: #4ec9b0;
  --acT-accent-bg: #144d3a;
  --acT-link: #569cd6;

  /* State colors */
  --acT-success: #4ec9b0;
  --acT-warning: #d7ba7d;
  --acT-error: #f48771;
  --acT-info: #569cd6;

  /* Status dot colors */
  --acT-dot-connected: #4ec9b0;
  --acT-dot-disconnected: #f48771;
  --acT-dot-connecting: #d7ba7d;

  /* Typography */
  --acT-font: -apple-system, 'Segoe UI', Roboto, sans-serif;
  --acT-mono: 'Cascadia Code', 'SF Mono', Consolas, monospace;
  --acT-fs-sm: 11px;
  --acT-fs-base: 13px;
  --acT-fs-md: 14px;

  /* Spacing */
  --acT-pad-sm: 6px;
  --acT-pad: 10px;
  --acT-pad-lg: 16px;
  --acT-radius: 4px;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body,
#root {
  height: 100%;
  width: 100%;
}

body {
  font-family: var(--acT-font);
  font-size: var(--acT-fs-base);
  line-height: 1.5;
  background: var(--acT-bg);
  color: var(--acT-text);
}
```

- [x] **Step 2: Commit**

```powershell
git add src/theme.css
git commit -m "feat: global dark theme tokens"
```

(The `feat:` prefix is intentional — this is the first user-visible production file.)

---

## Task 8: App shell — failing test first

**Files:**

- Create: `C:\TrajectoryActionTester\src\App.test.tsx`
- Create: `C:\TrajectoryActionTester\src\vitest.setup.ts`

- [x] **Step 1: Write the Vitest setup file**

Write `C:\TrajectoryActionTester\src\vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

This registers the jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`, etc.) on Vitest's `expect`.

- [x] **Step 2: Write the failing App test**

Write `C:\TrajectoryActionTester\src\App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the three-pane shell with header, sidebar, main, and inspector regions', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: /sidebar/i })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: /inspector/i })).toBeInTheDocument()
  })

  it('shows the project name in the header', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toHaveTextContent(/Trajectory Action Tester/i)
  })
})
```

Two regions are labeled `complementary` (HTML5 `<aside>`) and disambiguated by `aria-label`. The header is `<header role="banner">`. Main content is `<main>`. This shape locks in the three-pane semantic structure for future plans without prescribing visual specifics yet.

- [x] **Step 3: Run the test to confirm it fails**

```powershell
npm test
```

Expected: 1 file failed, 2 tests failed — both with "Cannot find module './App'" (or similar resolution failure). This is the right failure: we haven't written `App.tsx` yet.

- [x] **Step 4: No commit yet**

The failing test is a useful checkpoint but not a meaningful commit on its own. We'll commit together with the implementation in Task 9.

---

## Task 9: App shell — minimal implementation

**Files:**

- Create: `C:\TrajectoryActionTester\src\App.tsx`
- Create: `C:\TrajectoryActionTester\src\App.module.css`

- [x] **Step 1: Write the App component**

Write `C:\TrajectoryActionTester\src\App.tsx`:

```tsx
import styles from './App.module.css'

export function App() {
  return (
    <div className={styles.shell}>
      <header className={styles.header} role="banner">
        <span className={styles.dot} aria-label="disconnected" />
        <span className={styles.title}>Trajectory Action Tester</span>
      </header>
      <aside className={styles.sidebar} aria-label="Sidebar">
        <p className={styles.placeholder}>Connections, actions, instances — coming in plan 4-02.</p>
      </aside>
      <main className={styles.main}>
        <p className={styles.placeholder}>
          Select an action or instance from the sidebar to begin.
        </p>
      </main>
      <aside className={styles.inspector} aria-label="Inspector">
        <p className={styles.placeholder}>Log inspector — coming in plan 4-05.</p>
      </aside>
    </div>
  )
}
```

- [x] **Step 2: Write the layout CSS**

Write `C:\TrajectoryActionTester\src\App.module.css`:

```css
.shell {
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: 240px 1fr 320px;
  grid-template-areas:
    'header header header'
    'sidebar main inspector';
  height: 100%;
}

.header {
  grid-area: header;
  display: flex;
  align-items: center;
  gap: var(--acT-pad-sm);
  background: var(--acT-panel-alt);
  border-bottom: 1px solid var(--acT-border);
  padding: var(--acT-pad) var(--acT-pad-lg);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--acT-dot-disconnected);
  display: inline-block;
}

.title {
  font-weight: 600;
  color: var(--acT-text);
}

.sidebar {
  grid-area: sidebar;
  background: var(--acT-panel);
  border-right: 1px solid var(--acT-divider);
  padding: var(--acT-pad);
  overflow-y: auto;
}

.main {
  grid-area: main;
  background: var(--acT-bg);
  padding: var(--acT-pad-lg);
  overflow-y: auto;
}

.inspector {
  grid-area: inspector;
  background: var(--acT-panel);
  border-left: 1px solid var(--acT-divider);
  padding: var(--acT-pad);
  overflow-y: auto;
}

.placeholder {
  color: var(--acT-text-muted);
  font-size: var(--acT-fs-sm);
}
```

- [x] **Step 3: Run the tests — they should pass now**

```powershell
npm test
```

Expected: 1 file passed, 2 tests passed.

- [x] **Step 4: Commit**

```powershell
git add src/App.tsx src/App.module.css src/App.test.tsx src/vitest.setup.ts
git commit -m "feat: empty three-pane app shell with passing tests"
```

---

## Task 10: Entry point + index.html

**Files:**

- Create: `C:\TrajectoryActionTester\index.html`
- Create: `C:\TrajectoryActionTester\src\main.tsx`

- [x] **Step 1: Write `index.html`**

Write `C:\TrajectoryActionTester\index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="acT-version" content="0.1.0" />
    <title>Trajectory Action Tester</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

The `acT-version` meta is the debugging tag mentioned in the spec — it travels into the built single-file artifact.

- [x] **Step 2: Write `main.tsx`**

Write `C:\TrajectoryActionTester\src\main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './theme.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in document')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
```

The QueryClient is wired up here even though no queries fire yet — plan 4-02 will add the first one. Defaults follow the console's conventions: 30s staleTime, no refetch on focus, single retry.

- [x] **Step 3: Verify dev server boots**

```powershell
npm run dev
```

Expected: Vite prints "Local: http://localhost:5173/" (or another free port) within a few seconds. Open that URL in a browser — you should see the dark three-pane layout with three placeholder messages.

Stop the dev server with Ctrl+C.

- [x] **Step 4: Verify lint and typecheck still pass**

```powershell
npm run lint
npm run typecheck
```

Expected: both pass with zero errors.

- [x] **Step 5: Commit**

```powershell
git add index.html src/main.tsx
git commit -m "feat: app entry point + QueryClientProvider"
```

---

## Task 11: Folder skeleton placeholders

**Files:**

- Create: `C:\TrajectoryActionTester\src\api\.gitkeep`
- Create: `C:\TrajectoryActionTester\src\store\.gitkeep`
- Create: `C:\TrajectoryActionTester\src\components\.gitkeep`
- Create: `C:\TrajectoryActionTester\src\features\.gitkeep`
- Create: `C:\TrajectoryActionTester\src\lib\.gitkeep`

Empty git-tracked placeholders so the directory structure is in place for plan 4-02 onward. The folders match the layout in `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md` § 4.

- [x] **Step 1: Create the empty placeholder files**

```powershell
New-Item -ItemType Directory -Path src\api,src\store,src\components,src\features,src\lib | Out-Null
New-Item -ItemType File -Path src\api\.gitkeep,src\store\.gitkeep,src\components\.gitkeep,src\features\.gitkeep,src\lib\.gitkeep | Out-Null
```

Expected: five `.gitkeep` files exist.

- [x] **Step 2: Commit**

```powershell
git add src/api src/store src/components src/features src/lib
git commit -m "chore: folder skeleton placeholders for plans 4-02..4-06"
```

---

## Task 12: Verify single-file build

**Files:**

- (no new files — verification only)

- [x] **Step 1: Run the build**

```powershell
npm run build
```

Expected output ends with something like:

```
✓ built in 1.23s
dist/index.html  ~150 kB
```

The `dist/` directory should contain exactly one file: `index.html`.

- [x] **Step 2: Verify single-file output**

```powershell
Get-ChildItem dist -Recurse
```

Expected: only `dist\index.html`. No separate `assets/` folder, no `.js`/`.css` sibling files.

- [x] **Step 3: Verify the built file works standalone**

```powershell
Start-Process dist\index.html
```

Expected: the OS opens the file in the default browser via `file://`. The three-pane dark shell renders identically to the dev-server version.

- [x] **Step 4: Measure size for the baseline log**

```powershell
$file = Get-Item dist\index.html
"Raw: $($file.Length) bytes"
$bytes = [System.IO.File]::ReadAllBytes($file.FullName)
$ms = New-Object System.IO.MemoryStream
$gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Compress)
$gz.Write($bytes, 0, $bytes.Length)
$gz.Dispose()
$gzippedBytes = $ms.ToArray().Length
"Gzipped: $gzippedBytes bytes"
```

(Use `$gz.Dispose()` then `$ms.ToArray().Length` — `$ms.Length` after `$gz.Close()` is unreliable on some PowerShell versions because the stream trailer write may leave the underlying buffer length inconsistent. Vite's own gzip estimate from the build output is a fine cross-check.)

Expected: raw size around 130-180 KB, gzipped around 50-70 KB. (Plan 4-06 budget is ≤ 200 KB gzipped for the FULL app; this scaffold should be well under it.)

Record the gzipped number in a comment in the next commit — it's the baseline you compare against in 4-06.

- [x] **Step 5: Commit (no files changed, but anchor the baseline measurement)**

```powershell
git commit --allow-empty -m "chore: verify single-file build (baseline: ~<NN> KB gzipped)"
```

Replace `<NN>` with the actual gzipped KB measurement from Step 4. Empty commit so the verification result is captured in history.

---

## Task 13: Final dev-loop sanity check

**Files:**

- (no new files — running verification)

- [x] **Step 1: Confirm every npm script succeeds**

Run each in sequence:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all four exit code 0. Lint clean, typecheck clean, two tests pass, build produces `dist/index.html`.

- [x] **Step 2: Confirm preview command works**

```powershell
npm run preview
```

Expected: serves the built `dist/` on a local URL (typically 4173). Open it — same three-pane shell. Stop with Ctrl+C.

- [x] **Step 3: Confirm git tree is clean**

```powershell
git status
```

Expected: "nothing to commit, working tree clean".

- [x] **Step 4: Confirm commit history is sensible**

```powershell
git log --oneline
```

Expected: roughly 10 commits matching the task structure above (chore: scaffold, chore: deps, chore: TS config, chore: Vite config, chore: ESLint, feat: theme, feat: shell, feat: entry point, chore: folder skeleton, chore: verify build).

---

## Self-Review checklist (for the executing engineer)

After all tasks complete, sanity-check against `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md` § 4 (Architecture):

- ✅ React 19 + Vite 6 + TypeScript strict — confirmed by `npm ls` and `tsconfig.app.json`.
- ✅ `vite-plugin-singlefile` — confirmed by `dist/` containing only `index.html`.
- ✅ `@tanstack/react-query` wired up at the root — confirmed by `main.tsx`.
- ✅ React Context (no Zustand) — no Zustand in `package.json`.
- ✅ EventSource — no library imported (we use the native one); deferred to plan 4-04.
- ✅ Vanilla CSS Modules (no Tailwind) — `App.module.css` is plain CSS; no Tailwind dep.
- ✅ Vitest + React Testing Library + jsdom — `App.test.tsx` runs.
- ✅ MSW dev dependency present — installed but unused until plan 4-04+.
- ✅ ESLint flat config + Prettier — `eslint.config.mjs` + `.prettierrc.json`.
- ✅ Folder layout matches spec — `src/{api,store,components,features,lib}` exist.
- ✅ `acT-version` meta tag in `index.html` — confirmed.
- ✅ Old `C:\ActionContainerTester\` removed; backup `C:\ActionContainerTester-OLD.zip` exists.

What's NOT in this plan and is handled later:

- ConnectionsContext + Connection bar UI → plan 4-02.
- `/capabilities` fetch via TanStack Query → plan 4-02.
- Action tree, invoke panel → plan 4-03.
- `useInstanceStream` hook + SSE → plan 4-04.
- State diagram + log inspector → plan 4-05.
- Output deltas + polish + bundle-size gate → plan 4-06.

---

## Failure recovery

If any task fails partway, the project is still in a valid state — each task ends with a commit. Recovery:

1. `git status` — see what's changed since the last commit.
2. If the partial change is broken: `git reset --hard HEAD` to revert.
3. Re-read the task's steps and re-run them.

If `npm install` fails: delete `node_modules/` and `package-lock.json`, then re-run.

If you suspect a Vite or React version-mismatch issue: confirm `node --version` is 20+, then `npm ls` to see resolved versions.
