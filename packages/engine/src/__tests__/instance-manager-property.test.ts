/**
 * instance-manager-property.test.ts — Integration tests for property_mutations flow.
 *
 * Tests that InstanceManager.applyPropertyMutations() correctly:
 *  1. Persists updated spec entries to the environment repository
 *  2. Publishes SSE 'property' events via sseManager.publishProperty
 *
 * Uses real :memory: SQLite database and real Python via sandbox_runner.py.
 * The Python action code writes to a property via trajectory.set_property().
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initializeDatabase,
  ActionRepository,
  EnvironmentRepository,
  CodeVersionRepository,
} from '@trajectory/storage'
import type BetterSqlite3 from 'better-sqlite3'
import { InstanceManager } from '../instance-manager/instance-manager.js'
import type { InstanceManagerOptions } from '../instance-manager/types.js'

// ============================================================
// Constants
// ============================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SCRIPT_PATH = path.resolve(__dirname, '../../../python-sidecar/sandbox_runner.py')

// ============================================================
// Shared state
// ============================================================

let db: BetterSqlite3.Database
let actionRepo: ActionRepository
let envRepo: EnvironmentRepository
let codeVersionRepo: CodeVersionRepository

// ============================================================
// beforeAll — minimal shared DB setup
// ============================================================

beforeAll(() => {
  db = initializeDatabase(':memory:')
  actionRepo = new ActionRepository(db)
  envRepo = new EnvironmentRepository(db)
  codeVersionRepo = new CodeVersionRepository(db)
})

// ============================================================
// createManager helper — accepts a sseManager stub
// ============================================================

function createManager(
  callbacks: Partial<InstanceManagerOptions> = {},
  sseManager?: {
    publishProperty: (
      envOid: string,
      name: string,
      data: {
        entries: Array<{ name: string; value: string }>
        changed_entries: string[]
        source: 'action_code'
        source_action_oid?: string
        source_instance_id?: string
      }
    ) => void
  }
): InstanceManager {
  return new InstanceManager(db, {
    scriptPath: SCRIPT_PATH,
    sseManager,
    ...callbacks,
  })
}

// ============================================================
// Test suite
// ============================================================

describe('InstanceManager — property_mutations', () => {
  // ----------------------------------------------------------
  // Test 1: applyPropertyMutations persists and publishes SSE
  // via a real Python action that writes a property
  // ----------------------------------------------------------

  it('applies property_mutations from sidecar response, persists, and publishes SSE', async () => {
    const propEnvOid = `env-prop-${Date.now()}`
    envRepo.create({
      oid: propEnvOid,
      local_id: 'prop-test-env',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      schema_version: '1',
      action_property_specifications: [
        {
          name: 'SIM',
          entries: [{ name: 'Mode', value: 'slow' }],
        },
      ],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'prop-test.json',
    })

    const propActionOid = `action-prop-${Date.now()}`
    actionRepo.create({
      oid: propActionOid,
      environment_oid: propEnvOid,
      local_id: 'prop-test-action',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      action_visibility: 'opaque', // single IN_PROGRESS state, no SSE endpoint needed
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    })

    codeVersionRepo.saveAndActivate({
      action_oid: propActionOid,
      state: 'IN_PROGRESS',
      // Use set_property (injected by sidecar into namespace) to emit a property_mutation
      source_code: [
        'def execute(inputs, outputs, props, action_props):',
        "    set_property('SIM', 'Mode', 'fast')",
        '    return True',
      ].join('\n'),
    })

    const sseSpy = vi.fn()
    const sseManager = { publishProperty: sseSpy }

    let terminalResolve: (id: string) => void
    const terminalPromise = new Promise<string>((resolve) => {
      terminalResolve = resolve
    })

    const manager = createManager(
      {
        onTerminal: (id) => {
          terminalResolve(id)
        },
      },
      sseManager
    )

    try {
      const result = await manager.invoke({
        action_oid: propActionOid,
        workflow_instance_id: `wf-prop-${Date.now()}`,
        step_instance_id: `step-prop-${Date.now()}`,
        step_oid: `step-oid-prop-${Date.now()}`,
        input_parameters: [],
      })

      await terminalPromise

      // 1. SSE publishProperty must have been called at least once
      expect(sseSpy).toHaveBeenCalledWith(
        propEnvOid,
        'SIM',
        expect.objectContaining({
          changed_entries: ['Mode'],
          source: 'action_code',
        })
      )

      // 2. Environment storage must reflect the updated value
      const env = envRepo.findByOid(propEnvOid)!
      const specs = env.action_property_specifications as Array<{
        name: string
        entries: Array<{ name: string; value: string }>
      }>
      const sim = specs.find((s) => s.name === 'SIM')
      expect(sim).toBeTruthy()
      const modeEntry = sim!.entries.find((e) => e.name === 'Mode')
      expect(modeEntry?.value).toBe('fast')

      // 3. SSE payload shape sanity-check
      const callArgs = sseSpy.mock.calls[0]
      expect(callArgs[0]).toBe(propEnvOid)
      expect(callArgs[1]).toBe('SIM')
      expect(callArgs[2].entries).toBeDefined()
      expect(callArgs[2].source_instance_id).toBe(result.runtime_action_instance_id)
    } finally {
      await manager.shutdown()
    }
  }, 60000)

  // ----------------------------------------------------------
  // Test 2: applyPropertyMutations is a no-op when mutations list is empty
  // ----------------------------------------------------------

  it('does not call publishProperty when property_mutations is empty', async () => {
    const noMutEnvOid = `env-nomut-${Date.now()}`
    envRepo.create({
      oid: noMutEnvOid,
      local_id: 'nomut-test-env',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      schema_version: '1',
      action_property_specifications: [
        {
          name: 'CFG',
          entries: [{ name: 'Key', value: 'original' }],
        },
      ],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'nomut-test.json',
    })

    const noMutActionOid = `action-nomut-${Date.now()}`
    actionRepo.create({
      oid: noMutActionOid,
      environment_oid: noMutEnvOid,
      local_id: 'nomut-test-action',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      action_visibility: 'opaque',
      input_parameter_specifications: [],
      output_parameter_specifications: [],
      property_specifications: [],
    })

    codeVersionRepo.saveAndActivate({
      action_oid: noMutActionOid,
      state: 'IN_PROGRESS',
      // No set_property calls — mutations will be empty
      source_code: 'def execute(inputs, outputs, props, action_props):\n    return True',
    })

    const sseSpy = vi.fn()
    const sseManager = { publishProperty: sseSpy }

    let terminalResolve: () => void
    const terminalPromise = new Promise<void>((resolve) => {
      terminalResolve = resolve
    })

    const manager = createManager(
      {
        onTerminal: () => {
          terminalResolve()
        },
      },
      sseManager
    )

    try {
      await manager.invoke({
        action_oid: noMutActionOid,
        workflow_instance_id: `wf-nomut-${Date.now()}`,
        step_instance_id: `step-nomut-${Date.now()}`,
        step_oid: `step-oid-nomut-${Date.now()}`,
        input_parameters: [],
      })

      await terminalPromise

      // No property mutations → publishProperty must NOT be called
      expect(sseSpy).not.toHaveBeenCalled()

      // Storage unchanged
      const env = envRepo.findByOid(noMutEnvOid)!
      const specs = env.action_property_specifications as Array<{
        name: string
        entries: Array<{ name: string; value: string }>
      }>
      const cfg = specs.find((s) => s.name === 'CFG')
      expect(cfg?.entries.find((e) => e.name === 'Key')?.value).toBe('original')
    } finally {
      await manager.shutdown()
    }
  }, 60000)
})
