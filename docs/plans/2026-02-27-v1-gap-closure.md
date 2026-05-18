# V1 Gap Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 6 gaps from the v1 milestone audit: wrong state names, broken timeline, timeout control, test panel UX, code template context, and visual state selector.

**Architecture:** Bug fixes first (state names, timeline type), then backend changes (timeout schema + validation + engine), then frontend features (visual diagram, enhanced test panel, rich template). Each task is independently committable.

**Tech Stack:** TypeScript, React 19, Tailwind CSS v4, better-sqlite3, Express 5, Vitest

---

## Task 1: Fix StateHistoryEntry type and InstanceDetailPage

Bug fix — the server sends `{ state, timestamp }` but the console expects `{ to_state, from_state, triggered_by, timestamp }`.

**Files:**

- Modify: `apps/console/src/lib/types.ts:283-288`
- Modify: `apps/console/src/features/instances/InstanceDetailPage.tsx:92,99`

**Step 1: Fix StateHistoryEntry interface**

In `apps/console/src/lib/types.ts`, replace the `StateHistoryEntry` interface (lines 283-288):

```typescript
// BEFORE:
export interface StateHistoryEntry {
  from_state: string | null
  to_state: string
  timestamp: string
  triggered_by: string
}

// AFTER:
export interface StateHistoryEntry {
  state: string
  timestamp: string
}
```

**Step 2: Fix InstanceDetailPage references**

In `apps/console/src/features/instances/InstanceDetailPage.tsx`, change `entry.to_state` to `entry.state` at lines 92 and 99:

```typescript
// Line 92 — BEFORE:
<StateDot state={entry.to_state} size="sm" />
// AFTER:
<StateDot state={entry.state} size="sm" />

// Line 99 — BEFORE:
<span className="font-medium text-sm">{entry.to_state}</span>
// AFTER:
<span className="font-medium text-sm">{entry.state}</span>
```

**Step 3: Fix TERMINAL_STATES in InstanceDetailPage**

At line 32, the set includes `'STOPPED'` which is not a real state:

```typescript
// BEFORE:
const TERMINAL_STATES = new Set(['COMPLETED', 'ABORTED', 'STOPPED'])
// AFTER:
const TERMINAL_STATES = new Set(['COMPLETED', 'ABORTED'])
```

**Step 4: Verify build**

Run: `cd apps/console && npx tsc --noEmit`
Expected: No type errors.

**Step 5: Commit**

```bash
git add apps/console/src/lib/types.ts apps/console/src/features/instances/InstanceDetailPage.tsx
git commit -m "fix(console): align StateHistoryEntry with server shape, fix timeline rendering"
```

---

## Task 2: Fix ActionDetailPage state names

The `CODE_STATES` array uses wrong names. Fix to match engine `states.ts`.

**Files:**

- Modify: `apps/console/src/features/actions/ActionDetailPage.tsx:16-33,160`

**Step 1: Replace CODE_STATES array**

In `apps/console/src/features/actions/ActionDetailPage.tsx`, replace the `CODE_STATES` array (lines 16-33):

```typescript
// BEFORE:
const CODE_STATES = [
  'STARTING',
  'EXECUTE',
  'PAUSING',
  'PAUSED',
  'RESUMING',
  'HOLDING',
  'HELD',
  'UNHOLDING',
  'STOPPING',
  'STOPPED',
  'ABORTING',
  'ABORTED',
  'CLEARING',
  'COMPLETING',
  'COMPLETE',
  'RESETTING',
]

// AFTER — matches packages/engine/src/state-machine/states.ts exactly:
const OBSERVABLE_CODE_STATES = [
  'STARTING',
  'EXECUTING',
  'COMPLETING',
  'COMPLETED',
  'PAUSING',
  'PAUSED',
  'UNPAUSING',
  'HOLDING',
  'HELD',
  'UNHOLDING',
  'ABORTING',
  'ABORTED',
  'CLEARING',
  'STOPPING',
]

const OPAQUE_CODE_STATES = [
  'POSTED',
  'RECEIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'ABORTING',
  'STOPPING',
]
```

**Step 2: Fix the state selection logic**

At line 160, update the ternary to use the new arrays:

```typescript
// BEFORE:
const applicableStates =
  visibility === 'opaque' ? ['STARTING', 'STOPPING', 'ABORTING', 'CLEARING'] : CODE_STATES

// AFTER:
const applicableStates = visibility === 'opaque' ? OPAQUE_CODE_STATES : OBSERVABLE_CODE_STATES
```

**Step 3: Verify build**

Run: `cd apps/console && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add apps/console/src/features/actions/ActionDetailPage.tsx
git commit -m "fix(console): correct ISA-88 state names in ActionDetailPage"
```

---

## Task 3: Add timeout_seconds column to actions table

Database migration + repository + type updates for per-action timeout.

**Files:**

- Create: `packages/storage/src/migrations/002-action-timeout.ts`
- Modify: `packages/storage/src/types.ts:27-38` (ActionRow) and corresponding domain/input types
- Modify: `packages/storage/src/repositories/action.repository.ts:61-89` (toRow/fromRow)
- Modify: `packages/storage/src/index.ts:19` (export new migration)
- Modify: `packages/storage/src/repositories/settings.repository.ts:22-24` (allow 0)

**Step 1: Create migration file**

Create `packages/storage/src/migrations/002-action-timeout.ts`:

```typescript
import type BetterSqlite3 from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  name: '002-action-timeout',
  up(db: BetterSqlite3.Database): void {
    db.exec(`ALTER TABLE actions ADD COLUMN timeout_seconds INTEGER DEFAULT NULL`)
  },
}
```

**Step 2: Update ActionRow type**

In `packages/storage/src/types.ts`, add `timeout_seconds` to `ActionRow` (after line 37):

```typescript
export interface ActionRow {
  oid: string
  environment_oid: string
  local_id: string
  version: string
  last_modified_date: string
  description: string | null
  action_visibility: Visibility
  input_parameter_specifications: string
  output_parameter_specifications: string
  property_specifications: string
  timeout_seconds: number | null // NEW
}
```

Add to `Action` domain type (add field):

```typescript
timeout_seconds: number | null // NULL = global default, 0 = disabled, >0 = custom seconds
```

Add to `ActionInput` type (add field):

```typescript
timeout_seconds?: number | null
```

**Step 3: Update action.repository.ts toRow/fromRow**

In `packages/storage/src/repositories/action.repository.ts`:

Add `timeout_seconds` to `toRow()`:

```typescript
timeout_seconds: input.timeout_seconds ?? null,
```

Add `timeout_seconds` to `fromRow()`:

```typescript
timeout_seconds: row.timeout_seconds,
```

Add `timeout_seconds` to the `update()` method's fieldMap:

```typescript
if ('timeout_seconds' in updates) {
  fields.push('timeout_seconds = ?')
  values.push(updates.timeout_seconds ?? null)
}
```

**Step 4: Register migration in index.ts**

In `packages/storage/src/index.ts`, add the new migration export and update `initializeDatabase`:

```typescript
// Add export:
export { migration as actionTimeoutMigration } from './migrations/002-action-timeout.js'

// Update initializeDatabase to include new migration:
import { migration as actionTimeoutMigration } from './migrations/002-action-timeout.js'

export function initializeDatabase(path: string): BetterSqlite3.Database {
  const db = openDatabase(path)
  runMigrations(db, [initialMigration, actionTimeoutMigration])
  return db
}
```

**Step 5: Allow timeout 0 in SettingsRepository**

In `packages/storage/src/repositories/settings.repository.ts`, change the `execution_timeout_ms` validation (lines 22-24):

```typescript
// BEFORE:
case 'execution_timeout_ms':
  if (!Number.isInteger(num) || num < 1000) {
    throw new ValidationError(key, 'must be an integer >= 1000')
  }

// AFTER:
case 'execution_timeout_ms':
  if (!Number.isInteger(num) || (num !== 0 && num < 1000)) {
    throw new ValidationError(key, 'must be 0 (disabled) or an integer >= 1000')
  }
```

**Step 6: Build and test**

Run: `npm run build && npm test`
Expected: All tests pass, build clean. Existing storage tests unaffected (migration adds nullable column).

**Step 7: Commit**

```bash
git add packages/storage/src/migrations/002-action-timeout.ts packages/storage/src/types.ts packages/storage/src/repositories/action.repository.ts packages/storage/src/repositories/settings.repository.ts packages/storage/src/index.ts
git commit -m "feat(storage): add per-action timeout_seconds column and allow global timeout disable"
```

---

## Task 4: Engine timeout resolution with per-action support

Update the state machine and worker to support timeout=0 (disabled) and per-action override.

**Files:**

- Modify: `packages/engine/src/state-machine/state-machine.ts:240-241`
- Modify: `packages/engine/src/python-pool/worker.ts:139-149`

**Step 1: Update StateMachine.executeCode() timeout resolution**

In `packages/engine/src/state-machine/state-machine.ts`, replace the timeout resolution at line 241:

```typescript
// BEFORE (line 241):
const timeoutMs = this.settingsRepo.getNumericValue('execution_timeout_ms') ?? 60000

// AFTER:
// Per-action timeout takes precedence over global setting
let timeoutMs: number
if (this.actionRepo) {
  const action = this.actionRepo.findByOid(instance.action_oid)
  if (action && action.timeout_seconds !== null && action.timeout_seconds !== undefined) {
    // Per-action: 0 = disabled, >0 = seconds * 1000
    timeoutMs = action.timeout_seconds === 0 ? 0 : action.timeout_seconds * 1000
  } else {
    // Fall back to global setting
    timeoutMs = this.settingsRepo.getNumericValue('execution_timeout_ms') ?? 60000
  }
} else {
  timeoutMs = this.settingsRepo.getNumericValue('execution_timeout_ms') ?? 60000
}
```

**Step 2: Skip timeout in worker when timeoutMs is 0**

In `packages/engine/src/python-pool/worker.ts`, guard the timeout setup (lines 139-149):

```typescript
// BEFORE:
// Set a timeout with a grace period beyond the Python-side timeout
const timeoutMs = request.timeout_ms + 5000
this.timeoutHandle = setTimeout(() => {
  this.timeoutHandle = undefined
  if (this.pendingReject) {
    const rejectFn = this.pendingReject
    this.pendingResolve = undefined
    this.pendingReject = undefined
    rejectFn(new Error(`Worker timed out after ${timeoutMs}ms`))
  }
}, timeoutMs)

// AFTER:
// Set a timeout with a grace period — skip entirely when timeout is 0 (disabled)
if (request.timeout_ms > 0) {
  const nodeTimeoutMs = request.timeout_ms + 5000
  this.timeoutHandle = setTimeout(() => {
    this.timeoutHandle = undefined
    if (this.pendingReject) {
      const rejectFn = this.pendingReject
      this.pendingResolve = undefined
      this.pendingReject = undefined
      rejectFn(new Error(`Worker timed out after ${nodeTimeoutMs}ms`))
    }
  }, nodeTimeoutMs)
}
```

**Step 3: Build and test**

Run: `npm run build && npm test`
Expected: All tests pass. Existing timeout tests unaffected (they use non-zero timeouts).

**Step 4: Commit**

```bash
git add packages/engine/src/state-machine/state-machine.ts packages/engine/src/python-pool/worker.ts
git commit -m "feat(engine): per-action timeout resolution and timeout-disable support"
```

---

## Task 5: Management API timeout endpoint

Add `PUT /management/v1/actions/:oid/timeout` to set per-action timeout.

**Files:**

- Modify: `packages/server/src/routes/management.ts`

**Step 1: Add the timeout endpoint**

In `packages/server/src/routes/management.ts`, add the endpoint near the other action endpoints (after the GET /actions/:oid route):

```typescript
// PUT /actions/:oid/timeout — set per-action timeout
router.put('/actions/:oid/timeout', (req, res, next) => {
  try {
    const actionOid = req.params.oid as string
    const action = actionRepo.findByOid(actionOid)
    if (!action) {
      return void res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Action not found: ${actionOid}` },
      })
    }

    const { timeout_seconds } = req.body as { timeout_seconds: number | null }

    // Validate: null (global default), 0 (disabled), or positive integer
    if (timeout_seconds !== null) {
      if (
        typeof timeout_seconds !== 'number' ||
        !Number.isInteger(timeout_seconds) ||
        timeout_seconds < 0
      ) {
        return void res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'timeout_seconds must be null, 0, or a positive integer',
          },
        })
      }
    }

    actionRepo.update(actionOid, { timeout_seconds })

    const updated = actionRepo.findByOid(actionOid)
    res.json({ data: { oid: actionOid, timeout_seconds: updated?.timeout_seconds ?? null } })
  } catch (err) {
    next(err)
  }
})
```

**Step 2: Include timeout_seconds in action detail response**

Find the existing `GET /actions/:oid` route and add `timeout_seconds` to its response object.

**Step 3: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add packages/server/src/routes/management.ts
git commit -m "feat(api): add PUT /actions/:oid/timeout endpoint for per-action timeout"
```

---

## Task 6: Enhanced code template with parameter context

Update `generateTemplate()` to include full parameter/property definitions as comments.

**Files:**

- Modify: `apps/console/src/features/code-editor/CodeEditorPage.tsx:43-64`

**Step 1: Replace generateTemplate function**

In `apps/console/src/features/code-editor/CodeEditorPage.tsx`, replace the `generateTemplate` function (lines 43-64):

```typescript
function generateTemplate(
  actionName: string,
  state: string,
  action: ActionDetail | undefined
): string {
  const lines: string[] = [
    'def execute(inputs, outputs, props, action_props):',
    '    """',
    `    State handler for ${actionName} - ${state}`,
    '',
    '    Return True to advance to next state.',
    '    Return False to trigger HOLD.',
    '    """',
  ]

  // Input parameters section
  const inputSpecs = action?.input_parameter_specifications ?? []
  if (inputSpecs.length > 0) {
    lines.push('')
    lines.push('    # -- Input Parameters ------------------------------------')
    for (const p of inputSpecs) {
      const defaultPart = p.default_value ? `  default: "${p.default_value}"` : ''
      const descPart = p.description ? `  - ${p.description}` : ''
      lines.push(`    # inputs['${p.id}']    (${p.value_type})${defaultPart}${descPart}`)
    }
  }

  // Output parameters section
  const outputSpecs = action?.output_parameter_specifications ?? []
  if (outputSpecs.length > 0) {
    lines.push('')
    lines.push('    # -- Output Parameters -----------------------------------')
    for (const p of outputSpecs) {
      const descPart = p.description ? `  - ${p.description}` : ''
      lines.push(`    # outputs['${p.id}']    (${p.value_type})${descPart}`)
    }
  }

  // Action properties section
  const propSpecs = action?.property_specifications ?? []
  if (propSpecs.length > 0) {
    lines.push('')
    lines.push('    # -- Action Properties -----------------------------------')
    for (const group of propSpecs) {
      for (const entry of group.entries) {
        lines.push(`    # action_props['${group.name}']['${entry.name}']  = "${entry.value}"`)
      }
    }
  }

  lines.push('')
  lines.push('    return True')
  lines.push('')

  return lines.join('\n')
}
```

**Step 2: Verify build**

Run: `cd apps/console && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add apps/console/src/features/code-editor/CodeEditorPage.tsx
git commit -m "feat(console): rich code template with input/output/property definitions"
```

---

## Task 7: Enhanced TestPanel with parameter names and output labels

Update TestPanel to show human-readable labels and structured output display.

**Files:**

- Modify: `apps/console/src/features/code-editor/TestPanel.tsx`
- Modify: `apps/console/src/features/code-editor/CodeEditorPage.tsx` (pass new props)

**Step 1: Update TestPanel props and display**

Rewrite `apps/console/src/features/code-editor/TestPanel.tsx`:

```typescript
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTestCode } from './hooks'
import { formatDuration } from '@/lib/utils'
import type { InputParameterSpec, OutputParameterSpec } from '@/lib/types'

interface TestPanelProps {
  actionOid: string
  state: string
  code: string
  inputParameters: InputParameterSpec[]
  outputParameters: OutputParameterSpec[]
}

export default function TestPanel({
  actionOid,
  state,
  code,
  inputParameters,
  outputParameters,
}: TestPanelProps) {
  const [testInputs, setTestInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputParameters.map((p) => [p.id, p.default_value ?? '']))
  )

  const testMutation = useTestCode()

  function handleInputChange(name: string, value: string) {
    setTestInputs((prev) => ({ ...prev, [name]: value }))
  }

  function handleRunTest() {
    testMutation.mutate({ actionOid, state, code, inputs: testInputs })
  }

  const result = testMutation.data

  // Build a lookup for output parameter metadata
  const outputParamMap = new Map(outputParameters.map((p) => [p.id, p]))

  return (
    <Card className="border-t-0 rounded-t-none border-primary/30">
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Test Execution</CardTitle>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleRunTest}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? 'Running...' : 'Run Test'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Input fields */}
        {inputParameters.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {inputParameters.map((param) => (
              <div key={param.id} className="space-y-1">
                <Label htmlFor={`test-input-${param.id}`} className="text-xs font-medium">
                  {param.id}
                  {param.value_type && (
                    <span className="ml-1 text-muted-foreground font-normal">
                      ({param.value_type})
                    </span>
                  )}
                </Label>
                <Input
                  id={`test-input-${param.id}`}
                  className="h-7 text-xs font-mono"
                  value={testInputs[param.id] ?? ''}
                  onChange={(e) => handleInputChange(param.id, e.target.value)}
                  placeholder={param.default_value ?? ''}
                />
                {param.description && (
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {param.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No input parameters</p>
        )}

        {/* Error from mutation */}
        {testMutation.isError && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2">
            <p className="text-xs text-destructive font-medium">Test request failed</p>
            <p className="text-xs text-destructive mt-0.5">
              {testMutation.error instanceof Error ? testMutation.error.message : 'Unknown error'}
            </p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-2.5 border-t pt-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant={result.success ? 'default' : 'destructive'} className="text-xs">
                {result.success ? 'Success' : 'Failed'}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDuration(result.execution_time_ms)}
              </span>
              {result.return_value !== null && result.return_value !== undefined && (
                <span className="text-xs text-muted-foreground">
                  return:{' '}
                  <span className="font-mono text-foreground">{String(result.return_value)}</span>
                </span>
              )}
            </div>

            {/* Outputs — labeled table */}
            {result.outputs && Object.keys(result.outputs).length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1">Outputs</p>
                <div className="rounded border text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-2 py-1 font-medium">Parameter</th>
                        <th className="text-left px-2 py-1 font-medium">Value</th>
                        <th className="text-left px-2 py-1 font-medium text-muted-foreground">
                          Type
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.outputs).map(([key, value]) => {
                        const spec = outputParamMap.get(key)
                        return (
                          <tr key={key} className="border-b last:border-b-0">
                            <td className="px-2 py-1 font-mono">{key}</td>
                            <td className="px-2 py-1 font-mono">{String(value)}</td>
                            <td className="px-2 py-1 text-muted-foreground">
                              {spec?.value_type ?? ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Stdout */}
            {result.stdout_capture && (
              <div>
                <p className="text-xs font-medium mb-1">stdout</p>
                <pre className="text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32">
                  {result.stdout_capture}
                </pre>
              </div>
            )}

            {/* Stderr */}
            {result.stderr_capture && (
              <div>
                <p className="text-xs font-medium mb-1 text-orange-600">stderr</p>
                <pre className="text-xs font-mono bg-orange-50 border border-orange-200 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32 text-orange-800">
                  {result.stderr_capture}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 2: Pass outputParameters prop from CodeEditorPage**

In `apps/console/src/features/code-editor/CodeEditorPage.tsx`, update the TestPanel usage (around line 382):

```typescript
// BEFORE:
<TestPanel
  actionOid={selectedActionOid}
  state={selectedState}
  code={editorCode}
  inputParameters={actionData?.input_parameter_specifications ?? []}
/>

// AFTER:
<TestPanel
  actionOid={selectedActionOid}
  state={selectedState}
  code={editorCode}
  inputParameters={actionData?.input_parameter_specifications ?? []}
  outputParameters={actionData?.output_parameter_specifications ?? []}
/>
```

**Step 3: Verify build**

Run: `cd apps/console && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add apps/console/src/features/code-editor/TestPanel.tsx apps/console/src/features/code-editor/CodeEditorPage.tsx
git commit -m "feat(console): enhanced TestPanel with parameter descriptions and labeled outputs"
```

---

## Task 8: StateButton component

Create the reusable state button for the visual diagram.

**Files:**

- Create: `apps/console/src/features/code-editor/StateButton.tsx`

**Step 1: Create StateButton component**

Create `apps/console/src/features/code-editor/StateButton.tsx`:

```typescript
import { cn } from '@/lib/utils'

interface StateButtonProps {
  name: string
  hasCode: boolean
  isSelected: boolean
  isTerminal?: boolean
  onClick: (name: string) => void
}

export default function StateButton({
  name,
  hasCode,
  isSelected,
  isTerminal = false,
  onClick,
}: StateButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(name)}
      className={cn(
        'rounded-lg border px-2 py-1.5 text-[10px] font-medium leading-none transition-all',
        'min-w-[80px] text-center cursor-pointer',
        // Color fill based on code status
        hasCode
          ? 'bg-sky-200 border-sky-400 text-sky-900 hover:bg-sky-300'
          : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200',
        // Selected ring
        isSelected && 'ring-2 ring-primary ring-offset-1',
        // Terminal dimming
        isTerminal && !isSelected && 'opacity-60'
      )}
    >
      {name}
    </button>
  )
}
```

**Step 2: Verify build**

Run: `cd apps/console && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add apps/console/src/features/code-editor/StateButton.tsx
git commit -m "feat(console): StateButton component for visual state diagram"
```

---

## Task 9: ObservableDiagram component

Build the observable state machine layout matching ObservableStates.png.

**Files:**

- Create: `apps/console/src/features/code-editor/ObservableDiagram.tsx`

**Step 1: Create ObservableDiagram**

Create `apps/console/src/features/code-editor/ObservableDiagram.tsx`:

```typescript
import StateButton from './StateButton'

interface DiagramProps {
  statesWithCode: Set<string>
  selectedState: string | null
  onSelectState: (state: string) => void
}

const TERMINAL = new Set(['COMPLETED', 'ABORTED'])

export default function ObservableDiagram({
  statesWithCode,
  selectedState,
  onSelectState,
}: DiagramProps) {
  function btn(name: string) {
    return (
      <StateButton
        name={name}
        hasCode={statesWithCode.has(name)}
        isSelected={selectedState === name}
        isTerminal={TERMINAL.has(name)}
        onClick={onSelectState}
      />
    )
  }

  // Arrow helper — small SVG arrow pointing right, down, left, or up
  const arrowR = <span className="text-gray-400 text-xs leading-none px-0.5">&rarr;</span>
  const arrowL = <span className="text-gray-400 text-xs leading-none px-0.5">&larr;</span>
  const arrowD = (
    <div className="flex justify-center">
      <span className="text-gray-400 text-xs leading-none">&darr;</span>
    </div>
  )
  const arrowU = (
    <div className="flex justify-center">
      <span className="text-gray-400 text-xs leading-none">&uarr;</span>
    </div>
  )

  return (
    <div className="space-y-1 py-2">
      {/* Row 0: Hold loop + Stopping */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('UNHOLDING')}
        {arrowL}
        {btn('HELD')}
        {arrowL}
        {btn('HOLDING')}
        <span className="flex-1" />
        {btn('STOPPING')}
      </div>

      {/* Vertical arrows connecting hold loop to main flow */}
      <div className="flex items-center px-1">
        <div className="flex-1" />
        <div className="w-[80px]" />
        <div className="px-0.5" />
        <div className="w-[80px]" />
        <div className="px-0.5" />
        <div className="w-[80px] flex justify-center">
          <span className="text-gray-400 text-xs">&darr;</span>
        </div>
      </div>

      {/* Row 1: Main flow */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('STARTING')}
        {arrowR}
        {btn('EXECUTING')}
        {arrowR}
        {btn('COMPLETING')}
        {arrowR}
        {btn('COMPLETED')}
      </div>

      {/* Vertical arrows connecting main flow to pause loop */}
      {arrowD}

      {/* Row 2: Pause loop */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('UNPAUSING')}
        {arrowL}
        {btn('PAUSED')}
        {arrowL}
        {btn('PAUSING')}
      </div>

      {/* Vertical arrow to abort */}
      {arrowD}

      {/* Row 3: Abort + Clear */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('ABORTING')}
        {arrowR}
        {btn('ABORTED')}
        <span className="flex-1" />
        {btn('CLEARING')}
      </div>
    </div>
  )
}
```

**Step 2: Verify build**

Run: `cd apps/console && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add apps/console/src/features/code-editor/ObservableDiagram.tsx
git commit -m "feat(console): ObservableDiagram component matching ISA-88 state layout"
```

---

## Task 10: OpaqueDiagram component

Build the opaque state machine layout matching OpaqueStates.png.

**Files:**

- Create: `apps/console/src/features/code-editor/OpaqueDiagram.tsx`

**Step 1: Create OpaqueDiagram**

Create `apps/console/src/features/code-editor/OpaqueDiagram.tsx`:

```typescript
import StateButton from './StateButton'

interface DiagramProps {
  statesWithCode: Set<string>
  selectedState: string | null
  onSelectState: (state: string) => void
}

const TERMINAL = new Set(['COMPLETED'])

export default function OpaqueDiagram({
  statesWithCode,
  selectedState,
  onSelectState,
}: DiagramProps) {
  function btn(name: string) {
    return (
      <StateButton
        name={name}
        hasCode={statesWithCode.has(name)}
        isSelected={selectedState === name}
        isTerminal={TERMINAL.has(name)}
        onClick={onSelectState}
      />
    )
  }

  const arrowR = <span className="text-gray-400 text-xs leading-none px-0.5">&rarr;</span>

  return (
    <div className="space-y-1 py-2">
      {/* Row 0: Main flow */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('POSTED')}
        {arrowR}
        {btn('RECEIVED')}
        {arrowR}
        {btn('IN_PROGRESS')}
      </div>

      {/* Vertical arrows */}
      <div className="flex justify-center">
        <span className="text-gray-400 text-xs">&darr;</span>
      </div>

      {/* Row 1: Terminal + error paths */}
      <div className="flex items-center gap-0.5 justify-center">
        {btn('ABORTING')}
        <span className="flex-1" />
        {btn('STOPPING')}
        {arrowR}
        {btn('COMPLETED')}
      </div>
    </div>
  )
}
```

**Step 2: Verify build**

Run: `cd apps/console && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add apps/console/src/features/code-editor/OpaqueDiagram.tsx
git commit -m "feat(console): OpaqueDiagram component for opaque action states"
```

---

## Task 11: Rewrite CodeEditorPage with visual diagram and timeout badge

Replace the state dropdown with the visual diagram, widen the panel, add timeout badge.

**Files:**

- Modify: `apps/console/src/features/code-editor/CodeEditorPage.tsx`
- Modify: `apps/console/src/lib/api.ts` (add timeout endpoint)
- Modify: `apps/console/src/lib/types.ts` (add timeout_seconds to ActionDetail)

**Step 1: Add timeout_seconds to ActionDetail type**

In `apps/console/src/lib/types.ts`, add to the `ActionDetail` interface:

```typescript
timeout_seconds: number | null // NEW
```

**Step 2: Add timeout API call**

In `apps/console/src/lib/api.ts`, add:

```typescript
updateActionTimeout: (oid: string, timeout_seconds: number | null) =>
  apiFetch<{ oid: string; timeout_seconds: number | null }>(`/actions/${oid}/timeout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout_seconds }),
  }),
```

**Step 3: Rewrite CodeEditorPage**

Full rewrite of `apps/console/src/features/code-editor/CodeEditorPage.tsx`. Key changes:

1. Remove `OBSERVABLE_CODE_STATES` and `OPAQUE_CODE_STATES` arrays entirely
2. Import `ObservableDiagram` and `OpaqueDiagram`
3. Change left panel from `w-64` to `w-[450px]`
4. Remove the state `<Select>` dropdown
5. Add the diagram component between the action selector and the Save/Test buttons
6. Add a timeout badge below the action selector
7. Derive `statesWithCode` from `actionData?.code_summary`

The key layout structure becomes:

```tsx
<div className="flex gap-4 h-[calc(100vh-8rem)]">
  {/* Left panel — widened */}
  <div className="w-[450px] shrink-0 flex flex-col gap-3 overflow-y-auto pb-2">
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Code Editor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Environment selector — unchanged */}
        {/* Action selector — unchanged */}

        {/* Timeout badge (read-only) */}
        {actionData && (
          <div className="text-xs text-muted-foreground">
            Timeout:{' '}
            {actionData.timeout_seconds === null
              ? `${Math.round((settingsTimeout ?? 60000) / 1000)}s (global default)`
              : actionData.timeout_seconds === 0
                ? 'disabled'
                : `${actionData.timeout_seconds}s (custom)`}
          </div>
        )}

        {/* Visual state diagram — replaces dropdown */}
        {selectedActionOid && actionData && (
          <div className="border rounded-md p-1 bg-muted/20">
            {actionData.action_visibility === 'opaque' ? (
              <OpaqueDiagram
                statesWithCode={statesWithCode}
                selectedState={selectedState}
                onSelectState={handleStateChange}
              />
            ) : (
              <ObservableDiagram
                statesWithCode={statesWithCode}
                selectedState={selectedState}
                onSelectState={handleStateChange}
              />
            )}
          </div>
        )}

        {/* Save / Test buttons — unchanged */}
      </CardContent>
    </Card>

    {/* Version History — unchanged */}
  </div>

  {/* Main editor area — unchanged */}
</div>
```

Derive `statesWithCode`:

```typescript
const statesWithCode = new Set(actionData?.code_summary?.states_with_code ?? [])
```

Note: Check the actual shape of `code_summary` — it may be `{ states_with_code: string[], total_versions: number }` (from `types.ts` line 171). Use `states_with_code` array directly.

**Step 4: Verify build and test visually**

Run: `cd apps/console && npx tsc --noEmit && npx vite build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add apps/console/src/features/code-editor/CodeEditorPage.tsx apps/console/src/lib/types.ts apps/console/src/lib/api.ts
git commit -m "feat(console): visual state diagram replaces dropdown, timeout badge, widened panel"
```

---

## Task 12: Action Detail page — timeout settings section

Add the per-action timeout radio group to the Action Detail page.

**Files:**

- Modify: `apps/console/src/features/actions/ActionDetailPage.tsx`
- Modify: `apps/console/src/features/actions/hooks.ts`

**Step 1: Add useUpdateActionTimeout hook**

In `apps/console/src/features/actions/hooks.ts`, add:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useAction(oid: string | undefined) {
  return useQuery({
    queryKey: ['actions', oid],
    queryFn: () => api.action(oid!),
    enabled: !!oid,
  })
}

export function useUpdateActionTimeout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ oid, timeout_seconds }: { oid: string; timeout_seconds: number | null }) =>
      api.updateActionTimeout(oid, timeout_seconds),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['actions', variables.oid] })
    },
  })
}
```

**Step 2: Add timeout section to ActionDetailPage**

In `apps/console/src/features/actions/ActionDetailPage.tsx`, add an "Execution Settings" card section. Import `useState` and `useUpdateActionTimeout`. Add a component like:

```tsx
function TimeoutSection({ action }: { action: ActionDetail }) {
  const updateTimeout = useUpdateActionTimeout()
  const [mode, setMode] = useState<'global' | 'custom' | 'disabled'>(
    action.timeout_seconds === null
      ? 'global'
      : action.timeout_seconds === 0
        ? 'disabled'
        : 'custom'
  )
  const [customValue, setCustomValue] = useState(
    action.timeout_seconds && action.timeout_seconds > 0 ? String(action.timeout_seconds) : '60'
  )

  function handleSave() {
    const value =
      mode === 'global' ? null : mode === 'disabled' ? 0 : parseInt(customValue, 10) || 60
    updateTimeout.mutate({ oid: action.oid, timeout_seconds: value })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Execution Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="timeout"
              checked={mode === 'global'}
              onChange={() => setMode('global')}
            />
            Use global default
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="timeout"
              checked={mode === 'custom'}
              onChange={() => setMode('custom')}
            />
            Custom:
            <Input
              type="number"
              min="1"
              className="w-20 h-7 text-xs"
              value={customValue}
              onChange={(e) => {
                setCustomValue(e.target.value)
                setMode('custom')
              }}
              disabled={mode !== 'custom'}
            />
            <span className="text-xs text-muted-foreground">seconds</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="timeout"
              checked={mode === 'disabled'}
              onChange={() => setMode('disabled')}
            />
            Disabled (no timeout)
          </label>
        </div>
        <Button size="sm" onClick={handleSave} disabled={updateTimeout.isPending}>
          {updateTimeout.isPending ? 'Saving...' : 'Save'}
        </Button>
      </CardContent>
    </Card>
  )
}
```

Render `<TimeoutSection action={actionData} />` in the page body.

**Step 3: Verify build**

Run: `cd apps/console && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add apps/console/src/features/actions/ActionDetailPage.tsx apps/console/src/features/actions/hooks.ts
git commit -m "feat(console): per-action timeout settings on Action Detail page"
```

---

## Task 13: Settings page — display seconds, allow 0

Update the Settings page to show timeout in seconds and allow disabling.

**Files:**

- Modify: `apps/console/src/features/settings/SettingsPage.tsx:12-38`

**Step 1: Update DEFAULTS and SETTING_LABELS**

In `apps/console/src/features/settings/SettingsPage.tsx`:

```typescript
// BEFORE:
const DEFAULTS: Record<string, string> = {
  log_max_size: '10000',
  python_pool_size: '4',
  execution_timeout_ms: '60000',
  instance_retention_hours: '24',
}

const SETTING_LABELS: Record<string, { label: string; description: string; unit?: string }> = {
  // ...
  execution_timeout_ms: {
    label: 'Execution Timeout',
    description: 'Maximum time allowed for code execution per state',
    unit: 'ms per state',
  },
}

// AFTER:
const DEFAULTS: Record<string, string> = {
  log_max_size: '10000',
  python_pool_size: '4',
  execution_timeout_ms: '60000',
  instance_retention_hours: '24',
}

// Keys that should display in seconds (stored as ms in DB)
const MS_TO_SECONDS_KEYS = new Set(['execution_timeout_ms'])

const SETTING_LABELS: Record<string, { label: string; description: string; unit?: string }> = {
  // ...
  execution_timeout_ms: {
    label: 'Execution Timeout',
    description: 'Maximum time allowed for code execution per state. 0 = no timeout.',
    unit: 'seconds (0 = disabled)',
  },
}
```

**Step 2: Add conversion logic in form load/save**

In the `useEffect` that initializes form values from loaded settings, convert ms to seconds for display:

```typescript
useEffect(() => {
  if (settingsData) {
    const values: Record<string, string> = {}
    for (const item of settingsData.settings) {
      if (MS_TO_SECONDS_KEYS.has(item.key)) {
        values[item.key] = String(Math.round(Number(item.value) / 1000))
      } else {
        values[item.key] = item.value
      }
    }
    setFormValues(values)
  }
}, [settingsData])
```

In `handleSave`, convert seconds back to ms before sending:

```typescript
const handleSave = async () => {
  if (!settingsData) return
  setSaveError(null)
  setSaveSuccess(false)

  const changedFields = settingsData.settings.filter((item) => {
    const displayValue = MS_TO_SECONDS_KEYS.has(item.key)
      ? String(Math.round(Number(item.value) / 1000))
      : item.value
    return formValues[item.key] !== displayValue
  })

  try {
    for (const item of changedFields) {
      let valueToSend = formValues[item.key] ?? item.value
      if (MS_TO_SECONDS_KEYS.has(item.key)) {
        valueToSend = String(Number(valueToSend) * 1000)
      }
      await updateSetting.mutateAsync({ key: item.key, value: valueToSend })
    }
    setSaveSuccess(true)
  } catch (err) {
    setSaveError(err instanceof Error ? err.message : 'Failed to save settings')
  }
}
```

Also update `isDirty` comparison to account for conversion:

```typescript
const isDirty = settingsData
  ? settingsData.settings.some((item) => {
      const displayValue = MS_TO_SECONDS_KEYS.has(item.key)
        ? String(Math.round(Number(item.value) / 1000))
        : item.value
      return formValues[item.key] !== displayValue
    })
  : false
```

**Step 3: Verify build**

Run: `cd apps/console && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add apps/console/src/features/settings/SettingsPage.tsx
git commit -m "feat(console): display timeout in seconds, support 0 = disabled"
```

---

## Summary

| Task | Gap    | Description                                         |
| ---- | ------ | --------------------------------------------------- |
| 1    | UI-14  | Fix StateHistoryEntry type + timeline rendering     |
| 2    | UI-08  | Fix ActionDetailPage state names                    |
| 3    | ENG-07 | Add timeout_seconds column + allow global 0         |
| 4    | ENG-07 | Engine per-action timeout resolution                |
| 5    | ENG-07 | Management API timeout endpoint                     |
| 6    | UI-12  | Rich code template with parameter context           |
| 7    | UI-10  | Enhanced TestPanel with labels and output table     |
| 8    | Visual | StateButton component                               |
| 9    | Visual | ObservableDiagram component                         |
| 10   | Visual | OpaqueDiagram component                             |
| 11   | UI-08  | CodeEditorPage rewrite with diagram + timeout badge |
| 12   | ENG-07 | Action Detail page timeout settings                 |
| 13   | UI-16  | Settings page seconds display + disable support     |
