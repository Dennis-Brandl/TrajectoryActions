# ActionContainerTester Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone single-file web application that tests Trajectory Action Container REST protocol by browsing actions, invoking them with parameters, monitoring state via SSE, and sending control commands.

**Architecture:** One `index.html` file with embedded CSS and JS. No build step, no dependencies. Calls `/trajectory/v1/` REST endpoints directly from the browser. Configurable server URL for testing different containers.

**Tech Stack:** HTML5, vanilla CSS, vanilla JavaScript (ES2020+), EventSource API for SSE

---

## Task 1: Server-side fix — add environment_oid to capabilities

The capabilities endpoint omits `environment_oid`, but clients need it for the invoke call.

**Files:**

- Modify: `C:\TrajectoryActions\packages\server\src\routes\protocol.ts:91-103`

**Step 1: Add environment_oid to capabilities response**

In `packages/server/src/routes/protocol.ts`, find the capabilities endpoint (line 91) and add `environment_oid`:

```typescript
// In the actions.map() callback, add this line after action_oid:
environment_oid: action.environment_oid,
```

The full mapper becomes:

```typescript
const data = actions.map((action) => ({
  action_oid: action.oid,
  environment_oid: action.environment_oid, // NEW
  local_id: action.local_id,
  version: action.version,
  description: action.description,
  visibility: action.action_visibility,
  input_parameters: action.input_parameter_specifications,
  output_parameters: action.output_parameter_specifications,
  supported_commands:
    action.action_visibility === 'observable'
      ? ['PAUSE', 'RESUME', 'HOLD', 'UNHOLD', 'ABORT', 'STOP', 'CLEAR']
      : ['ABORT'],
}))
```

**Step 2: Build**

Run: `cd /c/TrajectoryActions && npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
cd /c/TrajectoryActions
git add packages/server/src/routes/protocol.ts
git commit -m "feat(protocol): include environment_oid in capabilities response"
```

---

## Task 2: Create project directory and README

**Files:**

- Create: `C:\ActionContainerTester\README.md`

**Step 1: Create directory and README**

```bash
mkdir -p /c/ActionContainerTester
```

Create `C:\ActionContainerTester\README.md`:

```markdown
# ActionContainerTester

A standalone browser-based tool for testing Trajectory Action Container REST protocol.

## Usage

1. Open `index.html` in a browser
2. Enter the Action Container server URL (default: `http://localhost:3001/trajectory/v1`)
3. Optionally enter an API key
4. Click **Connect** to load available actions
5. Select an action, fill in parameters, click **Start Action**
6. Monitor state changes in real-time via SSE
7. Send control commands (PAUSE, RESUME, ABORT, etc.)

## Features

- Browse available actions grouped by visibility (observable/opaque)
- Invoke actions with input parameter forms (pre-filled defaults)
- Real-time state monitoring via Server-Sent Events
- Send ISA-88 control commands with state-aware button enabling
- View output parameters on completion
- Configurable server URL for testing different containers
- No build step — single HTML file with embedded CSS and JS

## Requirements

- A modern web browser (Chrome, Firefox, Edge, Safari)
- A running Trajectory Action Container at the configured URL
- CORS must be enabled on the server (it is by default)

## REST Protocol Endpoints Used

| Endpoint                      | Purpose                          |
| ----------------------------- | -------------------------------- |
| `GET /health`                 | Connection check                 |
| `GET /capabilities`           | List available actions           |
| `POST /actions/:oid/invoke`   | Start an action instance         |
| `GET /instances/:id`          | Get instance status and outputs  |
| `GET /instances/:id/events`   | SSE stream for real-time updates |
| `POST /instances/:id/command` | Send control commands            |
```

**Step 2: Init git repo and commit**

```bash
cd /c/ActionContainerTester
git init
git add README.md
git commit -m "docs: initial README for ActionContainerTester"
```

---

## Task 3: Create index.html — HTML structure and CSS

Create the complete HTML shell with all styling. No JavaScript yet.

**Files:**

- Create: `C:\ActionContainerTester\index.html`

**Step 1: Create the file with HTML and CSS**

Create `C:\ActionContainerTester\index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ActionContainerTester</title>
    <style>
      *,
      *::before,
      *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      :root {
        --bg: #f8f9fa;
        --surface: #ffffff;
        --border: #dee2e6;
        --text: #212529;
        --text-muted: #6c757d;
        --primary: #0d6efd;
        --primary-hover: #0b5ed7;
        --success: #198754;
        --warning: #fd7e14;
        --danger: #dc3545;
        --info: #0dcaf0;
        --gray: #6c757d;
        --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        --mono: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
        --radius: 6px;
      }

      body {
        font-family: var(--font);
        background: var(--bg);
        color: var(--text);
        font-size: 14px;
        line-height: 1.5;
      }

      /* ---- Connection Bar ---- */
      .connection-bar {
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        padding: 12px 20px;
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .connection-bar label {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-muted);
      }

      .connection-bar input[type='text'] {
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-size: 13px;
        font-family: var(--mono);
        outline: none;
      }

      .connection-bar input[type='text']:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.15);
      }

      #server-url {
        width: 340px;
      }
      #api-key {
        width: 180px;
      }

      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
        background: var(--gray);
      }

      .status-dot.connected {
        background: var(--success);
      }
      .status-dot.error {
        background: var(--danger);
      }

      #status-text {
        font-size: 13px;
        color: var(--text-muted);
      }

      /* ---- Buttons ---- */
      button {
        padding: 6px 14px;
        border: 1px solid transparent;
        border-radius: var(--radius);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition:
          background 0.15s,
          opacity 0.15s;
        font-family: var(--font);
      }

      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-primary {
        background: var(--primary);
        color: white;
      }

      .btn-primary:hover:not(:disabled) {
        background: var(--primary-hover);
      }

      .btn-outline {
        background: transparent;
        border-color: var(--border);
        color: var(--text);
      }

      .btn-outline:hover:not(:disabled) {
        background: var(--bg);
      }

      .btn-danger {
        background: var(--danger);
        color: white;
      }

      .btn-danger:hover:not(:disabled) {
        background: #bb2d3b;
      }

      .btn-warning {
        background: var(--warning);
        color: white;
      }

      .btn-sm {
        padding: 4px 10px;
        font-size: 12px;
      }

      /* ---- Layout ---- */
      .main {
        display: flex;
        height: calc(100vh - 52px);
      }

      .left-panel {
        width: 380px;
        min-width: 380px;
        border-right: 1px solid var(--border);
        background: var(--surface);
        overflow-y: auto;
        padding: 16px;
      }

      .right-panel {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      }

      /* ---- Section headings ---- */
      .section-title {
        font-size: 15px;
        font-weight: 700;
        margin-bottom: 12px;
        color: var(--text);
      }

      .group-title {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
        margin: 16px 0 8px 0;
      }

      .group-title:first-child {
        margin-top: 0;
      }

      /* ---- Action Cards ---- */
      .action-card {
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 10px 12px;
        margin-bottom: 8px;
        cursor: pointer;
        transition:
          border-color 0.15s,
          background 0.15s;
      }

      .action-card:hover {
        border-color: var(--primary);
        background: #f0f6ff;
      }
      .action-card.selected {
        border-color: var(--primary);
        background: #e7f1ff;
      }

      .action-card .action-name {
        font-weight: 600;
        font-size: 14px;
      }

      .action-card .action-meta {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 2px;
      }

      /* ---- Invoke Form ---- */
      .invoke-section {
        margin-top: 20px;
        border-top: 1px solid var(--border);
        padding-top: 16px;
      }

      .invoke-section h3 {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 12px;
      }

      .param-field {
        margin-bottom: 10px;
      }

      .param-field label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 3px;
      }

      .param-field label .type-hint {
        font-weight: 400;
        color: var(--text-muted);
      }

      .param-field .description {
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 2px;
      }

      .param-field input {
        width: 100%;
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-size: 13px;
        font-family: var(--mono);
        outline: none;
      }

      .param-field input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.15);
      }

      /* ---- Instance Cards ---- */
      .instance-card {
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 14px 16px;
        margin-bottom: 12px;
        background: var(--surface);
      }

      .instance-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }

      .instance-title {
        font-weight: 600;
        font-size: 14px;
      }

      .instance-title .instance-id {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--text-muted);
        font-weight: 400;
        margin-left: 8px;
      }

      .state-badge {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .state-badge.active {
        background: #cfe2ff;
        color: #084298;
      }
      .state-badge.paused {
        background: #fff3cd;
        color: #664d03;
      }
      .state-badge.held {
        background: #fff3cd;
        color: #664d03;
      }
      .state-badge.completed {
        background: #d1e7dd;
        color: #0f5132;
      }
      .state-badge.aborted {
        background: #f8d7da;
        color: #842029;
      }
      .state-badge.error {
        background: #f8d7da;
        color: #842029;
      }
      .state-badge.stopping {
        background: #e2e3e5;
        color: #41464b;
      }

      .timeline {
        font-size: 12px;
        color: var(--text-muted);
        margin-bottom: 10px;
        line-height: 1.8;
      }

      .timeline .state-entry {
        display: inline;
      }

      .timeline .arrow {
        color: var(--border);
        margin: 0 4px;
      }

      .commands-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }

      .outputs-section {
        border-top: 1px solid var(--border);
        padding-top: 10px;
        margin-top: 10px;
      }

      .outputs-section h4 {
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 6px;
      }

      .output-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .output-table th,
      .output-table td {
        text-align: left;
        padding: 4px 8px;
        border-bottom: 1px solid var(--border);
      }

      .output-table th {
        font-weight: 600;
        color: var(--text-muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .output-table td.value {
        font-family: var(--mono);
      }

      .error-msg {
        color: var(--danger);
        font-size: 12px;
        margin-top: 6px;
        padding: 8px;
        background: #f8d7da;
        border-radius: var(--radius);
      }

      .elapsed {
        font-size: 12px;
        color: var(--text-muted);
        font-family: var(--mono);
      }

      .empty-state {
        text-align: center;
        color: var(--text-muted);
        padding: 40px 20px;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <!-- Connection Bar -->
    <div class="connection-bar">
      <label for="server-url">Server:</label>
      <input type="text" id="server-url" value="http://localhost:3001/trajectory/v1" />
      <label for="api-key">API Key:</label>
      <input type="text" id="api-key" placeholder="(optional)" />
      <button class="btn-primary" id="connect-btn">Connect</button>
      <span class="status-dot" id="status-dot"></span>
      <span id="status-text">Not connected</span>
    </div>

    <!-- Main Layout -->
    <div class="main">
      <!-- Left Panel: Action Browser -->
      <div class="left-panel">
        <div class="section-title">Available Actions</div>
        <div id="actions-list">
          <div class="empty-state">Connect to a server to browse actions</div>
        </div>
        <div id="invoke-section" class="invoke-section" style="display:none;">
          <h3 id="invoke-title">Invoke Action</h3>
          <div id="invoke-params"></div>
          <button class="btn-primary" id="start-btn" style="margin-top:12px; width:100%;">
            Start Action
          </button>
        </div>
      </div>

      <!-- Right Panel: Instance Monitor -->
      <div class="right-panel">
        <div class="section-title">Active Instances</div>
        <div id="instances-list">
          <div class="empty-state">No active instances. Select an action and click Start.</div>
        </div>
      </div>
    </div>

    <script>
      // JavaScript goes here in subsequent tasks
    </script>
  </body>
</html>
```

**Step 2: Verify the HTML renders**

Open `C:\ActionContainerTester\index.html` in a browser. You should see the connection bar, left panel with "Connect to a server" message, and right panel with "No active instances" message.

**Step 3: Commit**

```bash
cd /c/ActionContainerTester
git add index.html
git commit -m "feat: HTML structure and CSS styling"
```

---

## Task 4: JavaScript — API layer and connection

Add the `apiFetch` helper, connection logic, and capabilities loading.

**Files:**

- Modify: `C:\ActionContainerTester\index.html` (inside the `<script>` tag)

**Step 1: Add the JavaScript**

Replace the `<script>` section in `index.html` with:

```javascript
// ============================================================
// State
// ============================================================
let serverUrl = ''
let apiKey = ''
let actions = [] // from GET /capabilities
let selectedAction = null // currently selected action
let instances = new Map() // instanceId -> { data, eventSource, element }

// ============================================================
// DOM refs
// ============================================================
const $serverUrl = document.getElementById('server-url')
const $apiKey = document.getElementById('api-key')
const $connectBtn = document.getElementById('connect-btn')
const $statusDot = document.getElementById('status-dot')
const $statusText = document.getElementById('status-text')
const $actionsList = document.getElementById('actions-list')
const $invokeSection = document.getElementById('invoke-section')
const $invokeTitle = document.getElementById('invoke-title')
const $invokeParams = document.getElementById('invoke-params')
const $startBtn = document.getElementById('start-btn')
const $instancesList = document.getElementById('instances-list')

// ============================================================
// Persistence
// ============================================================
function loadSettings() {
  const saved = localStorage.getItem('act-tester-settings')
  if (saved) {
    try {
      const s = JSON.parse(saved)
      if (s.serverUrl) $serverUrl.value = s.serverUrl
      if (s.apiKey) $apiKey.value = s.apiKey
    } catch (_) {
      /* ignore */
    }
  }
}

function saveSettings() {
  localStorage.setItem(
    'act-tester-settings',
    JSON.stringify({
      serverUrl: $serverUrl.value,
      apiKey: $apiKey.value,
    })
  )
}

// ============================================================
// API layer
// ============================================================
async function apiFetch(path, options = {}) {
  const url = serverUrl + path
  const headers = { ...options.headers }
  if (apiKey) headers['X-API-Key'] = apiKey
  if (options.body) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, { ...options, headers })
  const json = await res.json()

  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }

  return json
}

// ============================================================
// Connection
// ============================================================
async function connect() {
  serverUrl = $serverUrl.value.replace(/\/+$/, '')
  apiKey = $apiKey.value.trim()
  saveSettings()

  setStatus('connecting', 'Connecting...')

  try {
    // Health check
    await apiFetch('/health')

    // Load capabilities
    const caps = await apiFetch('/capabilities')
    actions = caps.data || []

    setStatus(
      'connected',
      `Connected (${actions.length} action${actions.length !== 1 ? 's' : ''} available)`
    )
    renderActions()
  } catch (err) {
    setStatus('error', `Connection failed: ${err.message}`)
    actions = []
    renderActions()
  }
}

function setStatus(state, text) {
  $statusDot.className = 'status-dot'
  if (state === 'connected') $statusDot.classList.add('connected')
  else if (state === 'error') $statusDot.classList.add('error')
  $statusText.textContent = text
}

// ============================================================
// Render actions list
// ============================================================
function renderActions() {
  if (actions.length === 0) {
    $actionsList.innerHTML = '<div class="empty-state">No actions available</div>'
    $invokeSection.style.display = 'none'
    return
  }

  const observable = actions.filter((a) => a.visibility === 'observable')
  const opaque = actions.filter((a) => a.visibility === 'opaque')

  let html = ''

  if (observable.length > 0) {
    html += '<div class="group-title">Observable Actions</div>'
    html += observable.map((a) => actionCardHtml(a)).join('')
  }

  if (opaque.length > 0) {
    html += '<div class="group-title">Opaque Actions</div>'
    html += opaque.map((a) => actionCardHtml(a)).join('')
  }

  $actionsList.innerHTML = html

  // Click handlers
  $actionsList.querySelectorAll('.action-card').forEach((card) => {
    card.addEventListener('click', () => selectAction(card.dataset.oid))
  })
}

function actionCardHtml(action) {
  const inputCount = (action.input_parameters || []).length
  const outputCount = (action.output_parameters || []).length
  const sel = selectedAction?.action_oid === action.action_oid ? ' selected' : ''

  return `<div class="action-card${sel}" data-oid="${action.action_oid}">
    <div class="action-name">${esc(action.local_id)}</div>
    <div class="action-meta">
      ${esc(action.action_oid)}<br>
      ${inputCount} input${inputCount !== 1 ? 's' : ''}, ${outputCount} output${outputCount !== 1 ? 's' : ''}
      &middot; ${action.visibility}
    </div>
  </div>`
}

// ============================================================
// Select action + render invoke form
// ============================================================
function selectAction(oid) {
  selectedAction = actions.find((a) => a.action_oid === oid) || null
  renderActions() // re-render to update selected state

  if (!selectedAction) {
    $invokeSection.style.display = 'none'
    return
  }

  $invokeSection.style.display = 'block'
  $invokeTitle.textContent = `Invoke: ${selectedAction.local_id}`

  const params = selectedAction.input_parameters || []
  if (params.length === 0) {
    $invokeParams.innerHTML =
      '<p style="color:var(--text-muted);font-size:12px;">No input parameters</p>'
  } else {
    $invokeParams.innerHTML = params
      .map(
        (p) => `
      <div class="param-field">
        <label>
          ${esc(p.id)}
          <span class="type-hint">(${esc(p.value_type || 'string')})</span>
        </label>
        <input type="text" data-param-id="${esc(p.id)}" value="${esc(p.default_value || '')}" />
        ${p.description ? `<div class="description">${esc(p.description)}</div>` : ''}
      </div>
    `
      )
      .join('')
  }
}

// ============================================================
// Util
// ============================================================
function esc(str) {
  if (!str) return ''
  const d = document.createElement('div')
  d.textContent = String(str)
  return d.innerHTML
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ============================================================
// Event listeners
// ============================================================
$connectBtn.addEventListener('click', connect)
$serverUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connect()
})

// Load saved settings on startup
loadSettings()
```

**Step 2: Verify in browser**

Open the file. Enter the server URL (with TrajectoryActions running on port 3001). Click Connect. The actions list should populate with action cards grouped by visibility. Clicking a card should show the invoke form with parameter fields.

**Step 3: Commit**

```bash
cd /c/ActionContainerTester
git add index.html
git commit -m "feat: API layer, connection logic, and action browser"
```

---

## Task 5: JavaScript — Invoke action and instance monitor

Add the invoke flow, SSE streaming, instance rendering, and command buttons.

**Files:**

- Modify: `C:\ActionContainerTester\index.html` (append to the `<script>` tag)

**Step 1: Add invoke and instance management code**

Append this JavaScript after the existing code in the `<script>` tag:

```javascript
// ============================================================
// Invoke action
// ============================================================
async function invokeAction() {
  if (!selectedAction) return

  // Collect input parameters
  const paramInputs = $invokeParams.querySelectorAll('input[data-param-id]')
  const inputParameters = Array.from(paramInputs).map((el) => ({
    name: el.dataset.paramId,
    value: el.value,
  }))

  $startBtn.disabled = true
  $startBtn.textContent = 'Starting...'

  try {
    const res = await apiFetch(`/actions/${selectedAction.action_oid}/invoke`, {
      method: 'POST',
      body: JSON.stringify({
        environment_oid: selectedAction.environment_oid,
        workflow_instance_id: 'test-' + uuid(),
        step_instance_id: 'step-' + uuid(),
        step_oid: 'test-step',
        input_parameters: inputParameters,
      }),
    })

    const instanceId = res.data.instance_id

    // Create instance tracker
    createInstance(instanceId, selectedAction)
  } catch (err) {
    alert('Invoke failed: ' + err.message)
  } finally {
    $startBtn.disabled = false
    $startBtn.textContent = 'Start Action'
  }
}

// ============================================================
// Instance tracking
// ============================================================
function createInstance(instanceId, action) {
  const inst = {
    id: instanceId,
    action: action,
    state: 'STARTING',
    timeline: [],
    outputs: null,
    error: null,
    startTime: Date.now(),
    eventSource: null,
  }

  instances.set(instanceId, inst)

  // Remove empty state message
  const emptyState = $instancesList.querySelector('.empty-state')
  if (emptyState) emptyState.remove()

  // Create card element
  const card = document.createElement('div')
  card.className = 'instance-card'
  card.id = `inst-${instanceId}`
  $instancesList.prepend(card)

  // Connect SSE
  connectSse(instanceId)

  // Initial render
  renderInstance(instanceId)

  // Also fetch current state in case SSE misses the initial state
  fetchInstanceState(instanceId)
}

async function fetchInstanceState(instanceId) {
  try {
    const res = await apiFetch(`/instances/${instanceId}`)
    const inst = instances.get(instanceId)
    if (!inst) return

    inst.state = res.data.state.current
    inst.outputs = res.data.outputs
    inst.error = res.data.error

    renderInstance(instanceId)
  } catch (_) {
    /* SSE will catch up */
  }
}

// ============================================================
// SSE streaming
// ============================================================
function connectSse(instanceId) {
  const inst = instances.get(instanceId)
  if (!inst) return

  let url = `${serverUrl}/instances/${instanceId}/events`

  // EventSource doesn't support custom headers natively.
  // If API key is needed, we can't use EventSource directly.
  // For now, use standard EventSource (works when no auth or auth is cookie-based).
  const es = new EventSource(url)
  inst.eventSource = es

  es.addEventListener('state-change', (e) => {
    try {
      const data = JSON.parse(e.data)
      inst.state = data.state || data.current_state || inst.state
      inst.timeline.push({
        state: inst.state,
        timestamp: data.timestamp || new Date().toISOString(),
      })
      renderInstance(instanceId)
    } catch (_) {}
  })

  es.addEventListener('terminal', (e) => {
    try {
      const data = JSON.parse(e.data)
      inst.state = data.state || data.current_state || inst.state
      inst.timeline.push({
        state: inst.state,
        timestamp: data.timestamp || new Date().toISOString(),
      })
    } catch (_) {}

    // Fetch final state for outputs
    fetchInstanceState(instanceId)

    // Close SSE
    es.close()
    inst.eventSource = null

    renderInstance(instanceId)
  })

  es.addEventListener('error', (e) => {
    // EventSource error could be network or server-closed
    // If the stream was closed by server (terminal), this fires too
    if (es.readyState === EventSource.CLOSED) {
      es.close()
      inst.eventSource = null
    }
  })
}

// ============================================================
// Render instance card
// ============================================================
function renderInstance(instanceId) {
  const inst = instances.get(instanceId)
  if (!inst) return

  const card = document.getElementById(`inst-${instanceId}`)
  if (!card) return

  const isTerminal = ['COMPLETED', 'ABORTED'].includes(inst.state)
  const elapsed = formatElapsed(Date.now() - inst.startTime)
  const stateClass = getStateClass(inst.state)

  // Timeline
  const timelineHtml =
    inst.timeline.length > 0
      ? inst.timeline
          .map((entry, i) => {
            const time = new Date(entry.timestamp).toLocaleTimeString()
            const arrow = i < inst.timeline.length - 1 ? '<span class="arrow">&rarr;</span>' : ''
            return `<span class="state-entry" title="${time}">${esc(entry.state)}</span>${arrow}`
          })
          .join('')
      : `<span class="state-entry">${esc(inst.state)}</span>`

  // Commands
  const commands = getAvailableCommands(inst.state, inst.action.visibility)
  const commandsHtml =
    commands.length > 0
      ? commands
          .map((cmd) => {
            const cls =
              cmd === 'ABORT' || cmd === 'STOP' ? 'btn-danger btn-sm' : 'btn-outline btn-sm'
            return `<button class="${cls}" onclick="sendCommand('${instanceId}','${cmd}')">${cmd}</button>`
          })
          .join('')
      : ''

  // Outputs
  let outputsHtml = ''
  if (inst.outputs && inst.outputs.length > 0) {
    const rows = inst.outputs
      .map((o) => `<tr><td>${esc(o.name)}</td><td class="value">${esc(o.value)}</td></tr>`)
      .join('')
    outputsHtml = `
      <div class="outputs-section">
        <h4>Outputs</h4>
        <table class="output-table">
          <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }

  // Error
  const errorHtml = inst.error ? `<div class="error-msg">${esc(inst.error)}</div>` : ''

  // Dismiss button for terminal instances
  const dismissHtml = isTerminal
    ? `<button class="btn-outline btn-sm" onclick="dismissInstance('${instanceId}')" style="margin-top:8px;">Dismiss</button>`
    : ''

  card.innerHTML = `
    <div class="instance-header">
      <div class="instance-title">
        ${esc(inst.action.local_id)}
        <span class="instance-id">${esc(instanceId.substring(0, 8))}...</span>
      </div>
      <div>
        <span class="state-badge ${stateClass}">${esc(inst.state)}</span>
        <span class="elapsed">${elapsed}</span>
      </div>
    </div>
    <div class="timeline">${timelineHtml}</div>
    ${commandsHtml ? `<div class="commands-row">${commandsHtml}</div>` : ''}
    ${errorHtml}
    ${outputsHtml}
    ${dismissHtml}
  `
}

// ============================================================
// Commands
// ============================================================
async function sendCommand(instanceId, command) {
  try {
    await apiFetch(`/instances/${instanceId}/command`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    })
    // SSE will update state, but also fetch to be safe
    setTimeout(() => fetchInstanceState(instanceId), 500)
  } catch (err) {
    alert(`Command ${command} failed: ${err.message}`)
  }
}

function getAvailableCommands(state, visibility) {
  if (visibility === 'opaque') {
    if (['POSTED', 'RECEIVED', 'IN_PROGRESS'].includes(state)) return ['ABORT']
    return []
  }

  // Observable
  switch (state) {
    case 'STARTING':
    case 'EXECUTING':
    case 'COMPLETING':
      return ['PAUSE', 'HOLD', 'ABORT', 'STOP']
    case 'PAUSING':
      return ['ABORT']
    case 'PAUSED':
      return ['RESUME', 'ABORT']
    case 'HOLDING':
      return ['ABORT']
    case 'HELD':
      return ['UNHOLD', 'ABORT']
    case 'UNPAUSING':
    case 'UNHOLDING':
      return ['ABORT']
    case 'ABORTING':
      return []
    case 'ABORTED':
      return ['CLEAR']
    case 'STOPPING':
    case 'CLEARING':
      return []
    case 'COMPLETED':
      return []
    default:
      return []
  }
}

// ============================================================
// Dismiss
// ============================================================
function dismissInstance(instanceId) {
  const inst = instances.get(instanceId)
  if (inst?.eventSource) inst.eventSource.close()
  instances.delete(instanceId)

  const card = document.getElementById(`inst-${instanceId}`)
  if (card) card.remove()

  if (instances.size === 0) {
    $instancesList.innerHTML =
      '<div class="empty-state">No active instances. Select an action and click Start.</div>'
  }
}

// ============================================================
// Helpers
// ============================================================
function getStateClass(state) {
  if (['COMPLETED'].includes(state)) return 'completed'
  if (['ABORTED'].includes(state)) return 'aborted'
  if (['PAUSED', 'PAUSING'].includes(state)) return 'paused'
  if (['HELD', 'HOLDING'].includes(state)) return 'held'
  if (['STOPPING', 'CLEARING'].includes(state)) return 'stopping'
  return 'active'
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

// ============================================================
// Wire up start button
// ============================================================
$startBtn.addEventListener('click', invokeAction)

// Update elapsed timers every second
setInterval(() => {
  for (const [id] of instances) {
    renderInstance(id)
  }
}, 1000)
```

**Step 2: End-to-end test**

1. Start the Trajectory Action Container (`npm run dev` in TrajectoryActions)
2. Open `index.html` in a browser
3. Click Connect — actions should load
4. Select an action, fill parameters, click Start Action
5. Watch the instance card update state in real-time
6. Try sending PAUSE, RESUME, ABORT commands
7. Verify outputs appear on COMPLETED

**Step 3: Commit**

```bash
cd /c/ActionContainerTester
git add index.html
git commit -m "feat: invoke actions, SSE streaming, instance monitor, control commands"
```

---

## Summary

| Task | Description                                                 |
| ---- | ----------------------------------------------------------- |
| 1    | Server-side: add environment_oid to capabilities            |
| 2    | Create project directory and README                         |
| 3    | HTML structure and CSS                                      |
| 4    | JavaScript: API layer, connection, action browser           |
| 5    | JavaScript: invoke, SSE streaming, instance cards, commands |
