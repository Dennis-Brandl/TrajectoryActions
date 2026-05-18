# Phase 1: Project Setup - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Monorepo scaffolding with all packages, shared TypeScript configuration, dev server proxy, and developer tooling. The workspace must build, dev-serve, and test cleanly. No application logic — just the foundation everything else builds on.

</domain>

<decisions>
## Implementation Decisions

### Package structure

- Python sidecar lives in its own package (packages/python-sidecar/) — treated as a first-class workspace member
- No reference project — build from scratch with standard conventions

### Dev workflow

- `npm run dev` starts server + console together in a single command (e.g., using concurrently)
- Server auto-restarts on TypeScript changes (tsx watch / nodemon style)
- Build errors surface in terminal AND via Vite error overlay in the browser for console issues
- Docker is deferred — dev workflow runs natively with Node/npm for now

### Tooling choices

- ESLint + Prettier for linting and formatting
- Pre-commit hooks with husky + lint-staged — auto-lint/format staged files before every commit
- Vitest workspace config at root — single vitest.workspace.ts, each package auto-discovered, `npm test` runs all

### Claude's Discretion

- Package split and naming convention (e.g., @trajectory/\* scoped vs flat naming, how many packages)
- TypeScript configuration (strictness, path aliases, module resolution)
- CI/CD in Phase 1 (whether to include a basic GitHub Actions workflow or defer)
- Exact dev tooling versions and configuration details

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 01-project-setup_
_Context gathered: 2026-02-25_
