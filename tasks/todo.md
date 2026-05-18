# Plan: TrajectoryActions integrates @trajectory/tokens + @trajectory/ui

## Goal

Wire ACTION to consume the family-shared design tokens and UI primitives published in MD's repo (commits `c6d8ca8` through `a0bf7f4` on `TrajectoryEditor/master`). Visual contract: **zero pixel changes** for existing ACTION users — both repos use shadcn-default OKLCH values, so the swap should be byte-equivalent for matching tokens.

## Decided choices

- **Consumption (B1):** `link:` dep — `"@trajectory/tokens": "link:../../../TrajectoryEditor/packages/tokens"` from `apps/console/package.json`. Symlinks via `node_modules/@trajectory/*`, picks up MD's live changes. Couples to filesystem layout (works since both repos are siblings).
- **Migration scope (B2):** Overlapping primitives only — `badge`, `button`, `dialog`, `input`, `label`, `select`. ACTION's 5 unique components (`card`, `separator`, `sheet`, `table`, `tabs`) stay in `apps/console/src/components/ui/`. Lifting them into `@trajectory/ui` is a follow-up when MD wants them too.
- **Radix peer deps:** ACTION adds individual `@radix-ui/react-*` packages matching `@trajectory/ui`'s peer set. Existing `radix-ui` umbrella stays for ACTION's own components (sheet/table/tabs use it). Both can coexist.
- **Brand variant:** `Button` from `@trajectory/ui` already has `variant="brand"`. ACTION gets it for free.

## Out of scope (deferred)

- Lifting `card`/`separator`/`sheet`/`table`/`tabs` into `@trajectory/ui` (follow-up — only when MD or web-ui actually needs them).
- Replacing `radix-ui` umbrella with individuals throughout ACTION's local components.
- Adding ACTION's `--activity-bar` / `--side-panel` / `--status-bar` to its login or chrome explicitly — they're already in `@trajectory/tokens` and consumed by ACTION's existing styling; nothing to migrate.
- web-ui token import → separate session.

## Tooling decisions / open questions

- **`@import 'shadcn/tailwind.css'` in ACTION's `index.css`** (line 3): MD doesn't have this. I need to investigate during Phase A1 — what does it provide, does it conflict with `@trajectory/tokens`? If it's just a stylistic add-on (animations / extra color utilities), keep it. If it defines color tokens, decide whether to keep, remove, or accept the override order.
- **Tailwind 4 `@source` path for the linked package:** ACTION's symlink resolves at `node_modules/@trajectory/ui` → `../../TrajectoryEditor/packages/ui`. From `apps/console/src/index.css`, the directive will be `@source "../../../node_modules/@trajectory/ui/src"` (3 `../` to climb to repo root). Tailwind follows the symlink and scans MD's source files.
- **ACTION ports:** dev:console runs on `5176`, server on `3002` (changed in commit `4b6dbda`). MD runs on `5174` + `3001`. No conflict expected during work; existing ACTION servers may already be running on these ports — if so, leave them alone (per memory: never kill sibling Trajectory apps' servers).

## ACTION inventory recap

| Component     | ACTION local | `@trajectory/ui` | Plan                                  |
| ------------- | ------------ | ---------------- | ------------------------------------- |
| alert-dialog  | —            | ✅               | available if ACTION needs it          |
| badge         | ✅           | ✅               | **migrate**                           |
| button        | ✅           | ✅               | **migrate** (gains `variant="brand"`) |
| card          | ✅           | —                | **stay local**                        |
| dialog        | ✅           | ✅               | **migrate**                           |
| dropdown-menu | —            | ✅               | available                             |
| input         | ✅           | ✅               | **migrate**                           |
| label         | ✅           | ✅               | **migrate**                           |
| radio-group   | —            | ✅               | available                             |
| scroll-area   | —            | ✅               | available                             |
| select        | ✅           | ✅               | **migrate**                           |
| separator     | ✅           | —                | **stay local**                        |
| sheet         | ✅           | —                | **stay local**                        |
| table         | ✅           | —                | **stay local**                        |
| tabs          | ✅           | —                | **stay local**                        |
| textarea      | —            | ✅               | available                             |

ACTION has no `cn` helper file at `src/lib/utils.ts` — need to verify that's where it lives, or wherever ACTION currently imports `cn` from.

---

## Phase A1 — Setup ✅

- [x] **MD repo path**: confirmed `C:\TrajectoryEditor` is sibling of `C:\TrajectoryActions`; relative path from `apps/console/package.json` is `../../../TrajectoryEditor/packages/{tokens,ui}` (3 `../` to climb to `C:\`).
- [x] **`shadcn/tailwind.css` investigation**: resolves to `node_modules/shadcn/dist/tailwind.css` — a 95-line file with shadcn-specific Tailwind 4 additions (accordion keyframes, custom variants like `data-open`/`data-closed`). Independent of design tokens. **Decision: keep the import** — it adds animations + variants @trajectory/tokens doesn't provide; no conflict.
- [x] **`cn` helper location**: confirmed at `apps/console/src/lib/utils.ts`. **Important:** that file ALSO exports `formatUptime`, `formatDuration`, `formatTimestamp` — used by 13 files. utils.ts must NOT be deleted in cleanup. Codemod for `cn` must be **line-exact** (only swap `import { cn } from '@/lib/utils'`), not path-replace.
- [x] **Added to `apps/console/package.json`**:
  - `"@trajectory/tokens": "file:../../../TrajectoryEditor/packages/tokens"`
  - `"@trajectory/ui": "file:../../../TrajectoryEditor/packages/ui"`
  - 8 individual `@radix-ui/react-*` packages (`alert-dialog`, `dialog`, `dropdown-menu`, `label`, `radio-group`, `scroll-area`, `select`, `slot`) at versions matching MD's lockfile. Existing `radix-ui` umbrella stays for ACTION's local components (sheet, table, tabs).
- [x] **Deviation from plan:** plan said `link:` deps (Yarn/pnpm syntax). npm 11.6.2 rejects `link:` with `EUNSUPPORTEDPROTOCOL`. Switched to `file:` which is npm's local-path syntax. **However:** with npm workspaces enabled (`workspaces: ["packages/*", "apps/*"]` in ACTION root), npm creates **actual symlinks** in `node_modules/@trajectory/{tokens,ui}` pointing at MD's directory — NOT copies. So live propagation is preserved exactly as intended.
- [x] **`npm install`** succeeded — added 5 packages (the radix individuals not already pulled transitively by `radix-ui` umbrella). No errors.
- [x] **Symlinks verified**: `node_modules/@trajectory/tokens` → `/c/TrajectoryEditor/packages/tokens/`, `node_modules/@trajectory/ui` → `/c/TrajectoryEditor/packages/ui/`. Both contain the expected files (dist/tokens.light.css, src/primitives/\*).

**Verification:** `tsc -b` exits 0. Symlinks resolve to MD's repo. ACTION's existing components still type-check (no @trajectory/\* imports added yet, so this just confirms nothing broke).

### Risk #2 update — `@source` path

Now that I can see the symlink layout, the `@source` directive path is straightforward. Tailwind 4 follows symlinks. From `apps/console/src/index.css`:

```css
@source "../../../node_modules/@trajectory/ui/src";
```

Three `../` to climb from `apps/console/src/` to ACTION repo root. The `node_modules/@trajectory/ui/src` symlink resolves to `C:\TrajectoryEditor\packages\ui\src`. To be set in Phase A3.

## Phase A2 — Tokens ✅

- [x] Inserted `@import '@trajectory/tokens/dist/tokens.light.css'` and `@import '@trajectory/tokens/dist/tokens.dark.css'` after existing `@import` lines (preserving `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`)
- [x] Added to `@theme inline { ... }` block: `--color-brand-accent: var(--brand-accent)` and `--color-brand-accent-foreground: var(--brand-accent-foreground)` — makes `bg-brand-accent` / `text-brand-accent-foreground` valid Tailwind utilities
- [x] Deleted ALL FOUR inline blocks: shadcn `:root`, shadcn `.dark`, IDE shell `:root` (`--activity-bar`, `--side-panel`, `--status-bar`), IDE shell `.dark`. All four are now provided by `@trajectory/tokens` — the shell tokens were lifted from ACTION during MD's Phase 2 work and live in `tokens/semantic/{light,dark}/shell.json`
- [x] File went from 138 → 59 lines (net −79: deleted 81 token lines, added 2 import lines + 2 brand bindings)
- [x] Booted Vite (v6.4.1) on `http://localhost:5176/`, ready in 1957ms

**Verification:**

- Served CSS at `http://localhost:5176/src/index.css` contains all expected tokens:
  - Family brand tokens: `--color-brand-gold`, `--color-brand-gold-hi`, `--color-brand-deep-blue`, `--brand-accent`
  - IDE shell tokens (now via `@trajectory/tokens`): `--activity-bar`, `--side-panel`, `--status-bar`
  - Standard semantic tokens: `--background`, `--primary`, `--ring`, etc. (full shadcn set)
- `tsc -b` exits 0
- Symlink chain: ACTION's `node_modules/@trajectory/tokens/dist/tokens.light.css` → `C:\TrajectoryEditor\packages\tokens\dist\tokens.light.css`. So if MD regenerates tokens via `npm run build --workspace=@trajectory/tokens`, ACTION picks up the change immediately on next CSS reload.

**Pixel parity:** values for the shell tokens (`--activity-bar`, etc.) and shadcn semantics (`--background`, etc.) are byte-identical to what ACTION had before — verified during MD's Phase 2 (the JSON values were lifted directly from ACTION's CSS).

## Phase A3 — Component migration (overlapping 6) + @source ✅

- [x] Added `@source "../../../node_modules/@trajectory/ui/src";` to `apps/console/src/index.css` after the `@import` block. Tailwind 4 follows the symlink (`node_modules/@trajectory/ui` → `C:\TrajectoryEditor\packages\ui`) and scans MD's component TSX
- [x] Codemod via `sed` across all .ts/.tsx in `apps/console/src/`:
  - 6 component path swaps: `@/components/ui/{badge,button,dialog,input,label,select}` → `@trajectory/ui`
  - 1 line-exact `cn` swap: `^import { cn } from '@/lib/utils'$` → `import { cn } from '@trajectory/ui'` (deliberately NOT a path-replace — the format-helper imports `formatUptime`/`formatDuration`/`formatTimestamp` from the same path stay intact)
- [x] `tsc -b` exits 0 (saw a transient `exit=1` from incremental cache during the chained Bash; fresh re-run was clean — same flicker observed during MD's Phase 5)

**Verification:**

- 0 remaining `@/components/ui/{badge,button,dialog,input,label,select}` imports in `apps/console/src/`
- 0 remaining `import { cn } from '@/lib/utils'` (line-exact)
- 11 imports of format helpers from `@/lib/utils` preserved (counted via grep)
- Served CSS at `http://localhost:5176/src/index.css` contains `.bg-brand-accent` and `.text-brand-accent-foreground` utility classes — proves the `@source` directive successfully scans the linked package's TSX and Tailwind generates utilities from `cva` strings inside `@trajectory/ui`'s button.tsx
- `tsc -b` clean

### Side effect — local kept components also use shared `cn`

The line-exact `cn` codemod swapped `cn` imports in ACTION's KEPT local components too (`card.tsx`, `separator.tsx`, `sheet.tsx`, `table.tsx`, `tabs.tsx`). They now import `cn` from `@trajectory/ui` instead of `@/lib/utils`. Functionally identical (cn is the same `clsx + twMerge` function), but creates a transitive dep from local components on `@trajectory/ui`. Cleaner — single source of truth for `cn`. Note this means after Phase A4 deletes the migrated 6 files, ACTION's `apps/console/src/lib/utils.ts` will no longer have any consumer for its `cn` export. Cleanup that in Phase A4.

## Phase A4 — Cleanup ✅

- [x] `git rm -f` on the 6 migrated component files: `badge.tsx`, `button.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`, `select.tsx`. The `-f` was needed because Phase A3's sed had modified them (cn-import swap) before deletion
- [x] Kept `card.tsx`, `separator.tsx`, `sheet.tsx`, `table.tsx`, `tabs.tsx` in place (5 ACTION-unique components that `@trajectory/ui` doesn't have)
- [x] Removed unused `cn` export from `src/lib/utils.ts` along with its `clsx` and `tailwind-merge` imports — verified zero consumers of `cn` from `@/lib/utils` remain (all `cn` consumers now import from `@trajectory/ui`). `utils.ts` retains its three format helpers (formatUptime, formatDuration, formatTimestamp) which are still consumed by 11 files
- [x] Final `tsc -b` exits 0
- [x] Vite served `http://localhost:5176/` returns HTTP 200; `main.tsx` compiles; Vite log shows clean HMR reloads through all the file changes — no errors

**Verification:** clean tsc, dev server serves, app compiles. Manual in-browser visual check is yours.

## Phase A5 — Document and commit ✅

- [x] todo.md updated phase-by-phase as work progressed
- [x] Single commit covering Phases A1–A4 — changes are localized to ACTION's `apps/console/` and root `package.json` / `package-lock.json`

---

## Review

### What shipped

- ACTION's `apps/console` consumes `@trajectory/tokens` (CSS tokens) and `@trajectory/ui` (6 shadcn primitives + cn) directly from MD's repo via npm `file:` deps. Workspaces resolve to symlinks, so live propagation works (MD edits → ACTION sees them on next reload, no re-install needed).
- ACTION's `index.css` shrunk from 138 → 59 lines (deleted 4 token blocks: shadcn `:root`/`.dark` + IDE shell `:root`/`.dark` — all subsumed by `@trajectory/tokens`). Added 2 `@import` lines for the token CSS, 2 brand-accent bindings in `@theme inline`, and 1 `@source` directive so Tailwind 4 scans the linked `@trajectory/ui` source.
- 6 ACTION-local UI components deleted: `badge.tsx`, `button.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`, `select.tsx`. All consumers swapped to `@trajectory/ui` via sed codemod.
- 5 ACTION-unique components kept: `card.tsx`, `separator.tsx`, `sheet.tsx`, `table.tsx`, `tabs.tsx`. They now import `cn` from `@trajectory/ui` (single source of truth).
- 8 individual `@radix-ui/react-*` packages added to satisfy `@trajectory/ui`'s peer deps. Existing `radix-ui` umbrella stays for the kept local components that use it.
- ACTION gains Button `variant="brand"` automatically (no place uses it yet — that's a UI design decision for later).

### What didn't ship (deferred)

- Lifting card/separator/sheet/table/tabs into `@trajectory/ui` — only when MD or web-ui actually wants them shared.
- Replacing `radix-ui` umbrella with individuals throughout ACTION's local components — would require rewriting card/sheet/table/tabs imports. Not necessary for current goal.
- web-ui token import → next session.

### Next session

- web-ui: just `@import '@trajectory/tokens/dist/tokens.light.css'` in its CSS entry. Don't pull `@trajectory/ui` (web-ui is intentionally minimal). Family color palette becomes available even if web-ui doesn't currently use them.

---

## Risks

1. **`shadcn/tailwind.css` package** — unknown contents. Could conflict with `@trajectory/tokens` (e.g., redefine the same vars in a different layer order). Mitigation: investigate in Phase A1; fallback is to remove the import.
2. **`@source` path resolution** — `../../../node_modules/@trajectory/ui/src` assumes ACTION's `node_modules` is hoisted at the workspace root. ACTION declares `workspaces: ["packages/*", "apps/*"]` so node_modules SHOULD be at root. But individual workspace package dependencies can sometimes get nested node_modules. Mitigation: verify `node_modules/@trajectory/ui` exists at expected path before writing the @source line; adjust path if hoisting differs.
3. **Radix API mismatch** — ACTION's local components use `Slot.Root`, `Dialog as DialogPrimitive` (umbrella namespace pattern). Migrated components from `@trajectory/ui` use `Slot` and `* as DialogPrimitive` (individual package pattern). For ACTION's KEPT components (card/separator/sheet/table/tabs) this doesn't matter — they keep using the umbrella. For migrated components there's no API change at the consumer level (`<Button>`, `<Dialog>` are the same JSX).
4. **`link:` peer-dep warnings** — npm may print warnings about unmet peer deps if ACTION's installed Radix versions don't match `@trajectory/ui`'s declared peer ranges. These are warnings, not errors. Mitigation: pin individual `@radix-ui/react-*` versions to match MD's lockfile range.

## Acceptance criteria

1. `apps/console/src/index.css` `:root` and `.dark` blocks deleted, replaced by `@import` from `@trajectory/tokens`.
2. ACTION imports the 6 overlapping primitives from `@trajectory/ui`, not local files.
3. Local copies of those 6 components are deleted; the 5 ACTION-unique stay.
4. `tsc -b` clean.
5. Dev server boots, app renders.
6. `@source` directive correctly scans `@trajectory/ui` source files; `bg-brand-accent` Tailwind utility appears in served CSS.
7. Pixel-identical render of ACTION's main screens before vs. after (manual QA).

---

## Review

_(filled after Phase A4 ships)_
