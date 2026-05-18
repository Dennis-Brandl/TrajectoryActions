# ActionContainerTester Design

**Date:** 2026-02-27
**Status:** Approved
**Scope:** Standalone web application for testing Trajectory Action Container REST protocol

## Purpose

A lightweight browser-based tool that exercises the Trajectory REST protocol (`/trajectory/v1/`) directly. Lets developers test action code and REST integration without needing Trajectory MD workflows or Trajectory Mobile. Designed to point at any action container (or compatible system) by changing the server URL.

## Architecture

**Single HTML file** — no build step, no npm, no dependencies. Open `index.html` in a browser. CSS and JS embedded in the file.

**Location:** `C:\ActionContainerTester\` (sibling to TrajectoryActions)

**Files:**

```
C:\ActionContainerTester\
  index.html      — complete application (HTML + CSS + JS)
  README.md       — usage instructions
```

## Layout

### Connection Bar

```
┌─────────────────────────────────────────────────────────────────────┐
│ Server: [http://localhost:3001/trajectory/v1  ] API Key: [________]  │
│ [Connect]  ● Connected (3 actions available)                       │
└─────────────────────────────────────────────────────────────────────┘
```

- Server URL defaults to `http://localhost:3001/trajectory/v1`
- Optional API key for `X-API-Key` header
- Connection status indicator (green = connected, red = error)
- Health check via `GET /health` on connect
- URL and API key stored in localStorage

### Left Panel — Action Browser

On connect, calls `GET /capabilities` to list available actions.

- Actions grouped by visibility (observable / opaque)
- Each action card shows: local_id, OID, input/output count
- Selecting an action shows input parameter form pre-filled with defaults
- "Start Action" button invokes the action

### Right Panel — Instance Monitor

Shows active and recently completed instances.

- Each instance gets an SSE connection (`GET /instances/:id/events`)
- State changes appear in real-time on a timeline
- Command buttons (PAUSE, RESUME, HOLD, UNHOLD, ABORT, STOP, CLEAR) enabled/disabled by state and visibility
- Completed instances show output parameters
- Error instances show error message
- Dismiss button to remove completed instances

## API Interaction

### apiFetch() Helper

All REST calls go through one function that:

- Prepends configured server URL
- Adds `X-API-Key` header if configured
- Parses JSON responses
- Extracts and displays errors

### Capabilities (GET /capabilities)

Response provides per-action: `action_oid`, `environment_oid`, `local_id`, `version`, `description`, `visibility`, `input_parameters`, `output_parameters`, `supported_commands`.

**Protocol fix required:** Add `environment_oid` to the capabilities response (currently missing — clients need it for invoke).

### Invoke (POST /actions/:action_oid/invoke)

Request body:

```json
{
  "environment_oid": "<from capabilities>",
  "workflow_instance_id": "test-<uuid>",
  "step_instance_id": "step-<uuid>",
  "step_oid": "test-step",
  "input_parameters": [{ "name": "...", "value": "..." }]
}
```

Auto-generated test values for workflow/step IDs since this is a tester.

### SSE Streaming (GET /instances/:id/events)

- One EventSource per active instance
- Listens for `state-change`, `terminal`, `error` events
- Updates instance card UI on each event
- On `terminal`: fetches final state via `GET /instances/:id` for outputs
- Closes EventSource on terminal or dismiss

### Commands (POST /instances/:id/command)

Sends `{ "command": "<COMMAND>" }`. Command buttons enabled based on:

| State                                         | Available Commands       |
| --------------------------------------------- | ------------------------ |
| EXECUTING, STARTING, COMPLETING               | PAUSE, HOLD, ABORT, STOP |
| PAUSED                                        | RESUME, ABORT            |
| HELD                                          | UNHOLD, ABORT            |
| ABORTED                                       | CLEAR                    |
| Opaque active (POSTED, RECEIVED, IN_PROGRESS) | ABORT only               |
| Terminal (COMPLETED)                          | none (Dismiss only)      |

## Styling

Minimal CSS with custom properties. No framework. State colors:

- Active (STARTING, EXECUTING, COMPLETING): blue
- Paused/Held: amber
- Completed: green
- Aborted/Error: red
- Stopping/Clearing: gray

## Server-Side Change

One-line addition to `packages/server/src/routes/protocol.ts` in the capabilities endpoint: add `environment_oid: action.environment_oid` to the response object.

---

_Design approved: 2026-02-27_
