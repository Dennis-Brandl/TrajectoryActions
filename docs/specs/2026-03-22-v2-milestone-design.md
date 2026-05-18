# v2 Milestone Design — DRAFT (In Progress)

**Status**: In progress — Phase 1 detailed, Phases 2-4 pending detail
**Date**: 2026-03-22
**Review**: User to review and provide comments

---

## Milestone Overview

Four phases in priority order:

1. **Import/Export Capability**
2. **Management Console Reskin**
3. **Test Action Scenarios** (Warehouse, Back Office Inventory, Industrial Kitchen)
4. **Trajectory Action Tester Rebuild**

---

## Key Decisions Made

### Import/Export (Phase 1)

- **Action-level export**: ZIP file with `.WFactionCode` extension containing active code per state as individual `.py` files + manifest.json
- **Container snapshot**: ZIP file with `.WFsnapshot` extension containing all environments, actions, active code, and settings
- **Active versions only**: Both export types include only active code versions, not full history
- **Execution log/instance history excluded** from snapshots — focused on deployable state
- **`.WFenvir` spec unchanged** — new formats are additive

### Console Reskin (Phase 2)

- **Top navigation bar** replacing the current left sidebar
- **Left tree panel** (VS Code explorer style) on detail pages for contextual navigation (Environment → Actions → States)
- **Search bar** in top nav for quick access
- **No branding changes** in this milestone — visual identity deferred to later
- **Focus**: UX polish, navigation flow, consistent layouts, responsive tables, sticky headers

### Test Action Scenarios (Phase 3)

- **3 independent environments**, ~10 actions each (not connected to each other)
- **Full simulation with failure modes** (random failures, HOLDs, timeouts)
- **`SIMULATION_MODE` property** to enable/disable failure modes (clean testing first, chaos later)
- **In-memory simulation** with per-environment simulated database state
- **Claude proposes action designs**, user approves before implementation
- Mix of observable and opaque actions to exercise the full ISA-88 state machine

### Trajectory Action Tester (Phase 4)

- **Rebuild as standalone React/Vite app** (not integrated into management console)
- **Not coupled to this container** — works with any Trajectory REST protocol implementation
- Proper component architecture, better SSE visualization, polished UI
- People will write containers in other languages; tester is a universal debugging tool
- See full design: `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md`

---

## Phase 1: Import/Export — Detailed Design

### Action Code Export (`.WFactionCode`)

**Format**: ZIP file

```
MyAction.WFactionCode (ZIP)
├── manifest.json          # Action metadata + code inventory
├── EXECUTING.py           # Active code for EXECUTING state
├── STARTING.py            # Active code for STARTING state
├── COMPLETING.py          # Active code for COMPLETING state
└── ABORTING.py            # Active code for ABORTING state
```

**manifest.json**:

```json
{
  "format_version": "1.0",
  "exported_at": "2026-03-22T10:30:00Z",
  "action": {
    "oid": "act-warehouse-pick-001",
    "local_id": "PickItem",
    "version": "1.0.0",
    "action_visibility": "observable",
    "description": "Pick an item from warehouse shelf",
    "input_parameter_specifications": [],
    "output_parameter_specifications": [],
    "property_specifications": [],
    "timeout_seconds": null
  },
  "code_files": [
    { "state": "EXECUTING", "filename": "EXECUTING.py", "description": "Main pick logic" },
    { "state": "ABORTING", "filename": "ABORTING.py", "description": "Cleanup on abort" }
  ]
}
```

The `.py` files are plain Python — developers open them in any editor, modify, and re-import.

### Export Flow

`GET /management/v1/actions/:oid/export` → server builds ZIP in memory → streams as download.

### Import Flow

`POST /management/v1/actions/:oid/import` with multipart `.WFactionCode` file:

1. Validate manifest matches target action OID (prevents importing code into wrong action)
2. For each `.py` file, create a new code version for that state
3. Activate the new versions
4. Existing code versions preserved (not deleted) — import adds new versions on top
5. States not in the ZIP are left untouched

### Container Snapshot Export/Import (`.WFsnapshot`)

**Format**: ZIP file

```
TrajectorySnapshot_2026-03-22.WFsnapshot (ZIP)
├── manifest.json              # Snapshot metadata
├── settings.json              # All settings key-value pairs
├── environments/
│   ├── env-warehouse-001.json # Environment spec (same shape as .WFenvir internal format)
│   ├── env-kitchen-001.json
│   └── env-backoffice-001.json
└── code/
    ├── act-warehouse-pick-001/
    │   ├── EXECUTING.py
    │   └── ABORTING.py
    ├── act-warehouse-put-001/
    │   └── EXECUTING.py
    └── ... (one dir per action with active code)
```

**manifest.json**:

```json
{
  "format_version": "1.0",
  "exported_at": "2026-03-22T10:30:00Z",
  "container_version": "1.0.0",
  "environment_count": 3,
  "action_count": 30,
  "code_file_count": 45
}
```

### Snapshot Export Flow

`GET /management/v1/snapshot/export` → server collects all environments, actions, active code, settings → builds ZIP → streams as download.

### Snapshot Import Flow

`POST /management/v1/snapshot/import?confirm=true` with multipart `.WFsnapshot` file:

1. Validate manifest and file structure
2. **Full replace** (not merge) — clear existing environments, actions, code versions
3. Re-create environments and actions from environment JSON files
4. Create and activate code versions from code directory
5. Apply settings

**Destructive operation**: API requires `?confirm=true` parameter. Console shows confirmation dialog with summary of what will be replaced.

### New Management API Endpoints

| Method | Endpoint                                      | Purpose                      |
| ------ | --------------------------------------------- | ---------------------------- |
| `GET`  | `/management/v1/actions/:oid/export`          | Download `.WFactionCode` ZIP |
| `POST` | `/management/v1/actions/:oid/import`          | Upload `.WFactionCode` ZIP   |
| `GET`  | `/management/v1/snapshot/export`              | Download `.WFsnapshot` ZIP   |
| `POST` | `/management/v1/snapshot/import?confirm=true` | Upload `.WFsnapshot` ZIP     |

### Console UI Changes

- **Action Detail page**: Add "Export Code" and "Import Code" buttons
- **Settings page** (or new top-nav item): Add "Export Snapshot" and "Import Snapshot" section with confirmation dialog
- Import results shown as summary: "Imported 3 environments, 30 actions, 45 code files, 4 settings"

---

## Phase 2: Console Reskin — Detailed Design

**Status**: Pending detailed design

### Decisions so far:

- Top navigation bar (replacing sidebar)
- Left tree panel on detail pages (VS Code explorer style)
- Search bar in top nav
- UX polish focus, branding deferred

---

## Phase 3: Test Action Scenarios — Detailed Design

**Status**: Pending detailed design

### Decisions so far:

- 3 independent environments (~10 actions each)
- Automated Warehouse (equipment simulation)
- Back Office Inventory (database simulation)
- Industrial Kitchen (equipment simulation)
- Full simulation with failure modes + SIMULATION_MODE toggle
- Claude to propose action designs for user approval

---

## Phase 4: Trajectory Action Tester Rebuild — Detailed Design

**Status**: Detailed design complete — see `docs/specs/2026-05-11-trajectory-action-tester-v2-design.md`.

### Decisions so far:

- Rebuild as standalone React/Vite app at `C:\TrajectoryActionTester\` (replacing `C:\ActionContainerTester\`)
- Universal tool — not coupled to this container implementation
- Better SSE visualization, proper component architecture
- Single-file HTML build via `vite-plugin-singlefile`
- Three-pane VS Code-style layout, IDE dark theme
- Multi-container connections persisted to localStorage
- Spec covers L1 (parity) + L2 (visualization) + L3 (scenario save/replay) + L4 (batch + assertions); Phase 4 implements L1 + L2
