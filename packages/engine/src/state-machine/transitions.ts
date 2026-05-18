import { ANY_ACTIVE_STATES } from './states.js'
import { InvalidStateTransitionError } from '../errors.js'

// ============================================================
// Transition table builder
// ============================================================

/**
 * Build the observable state TRANSITION_TABLE.
 * Maps (fromState, command) -> toState for all valid transitions
 * per StateMachineSpec.md §2, with CONTEXT.md extensions.
 */
function buildTransitionTable(): Map<string, Map<string, string>> {
  const table = new Map<string, Map<string, string>>()

  function addTransition(from: string, command: string, to: string): void {
    if (!table.has(from)) {
      table.set(from, new Map<string, string>())
    }
    table.get(from)!.set(command, to)
  }

  // ---- Client commands ----

  // PAUSE: only from EXECUTING
  addTransition('EXECUTING', 'PAUSE', 'PAUSING')

  // RESUME: only from PAUSED
  addTransition('PAUSED', 'RESUME', 'UNPAUSING')

  // UNHOLD: only from HELD
  addTransition('HELD', 'UNHOLD', 'UNHOLDING')

  // CLEAR: only from ABORTED
  addTransition('ABORTED', 'CLEAR', 'CLEARING')

  // HOLD valid from ALL active states (CONTEXT.md extension: mirrors ABORT flexibility)
  for (const state of ANY_ACTIVE_STATES) {
    addTransition(state, 'HOLD', 'HOLDING')
  }

  // ABORT valid from ALL active states
  for (const state of ANY_ACTIVE_STATES) {
    addTransition(state, 'ABORT', 'ABORTING')
  }

  // STOP valid from ALL active states
  for (const state of ANY_ACTIVE_STATES) {
    addTransition(state, 'STOP', 'STOPPING')
  }

  // ---- SC (auto-advance) transitions ----
  addTransition('STARTING', 'SC', 'EXECUTING')
  addTransition('EXECUTING', 'SC', 'COMPLETING')
  addTransition('COMPLETING', 'SC', 'COMPLETED')
  addTransition('PAUSING', 'SC', 'PAUSED')
  addTransition('UNPAUSING', 'SC', 'EXECUTING')
  addTransition('HOLDING', 'SC', 'HELD')
  addTransition('UNHOLDING', 'SC', 'EXECUTING')
  addTransition('ABORTING', 'SC', 'ABORTED')
  addTransition('STOPPING', 'SC', 'COMPLETED')
  addTransition('CLEARING', 'SC', 'COMPLETED')

  return table
}

/**
 * Build the opaque state TRANSITION_TABLE.
 * Opaque actions support SC, ABORT, and STOP only (no PAUSE/RESUME/HOLD/UNHOLD).
 */
function buildOpaqueTransitionTable(): Map<string, Map<string, string>> {
  const table = new Map<string, Map<string, string>>()

  function addTransition(from: string, command: string, to: string): void {
    if (!table.has(from)) {
      table.set(from, new Map<string, string>())
    }
    table.get(from)!.set(command, to)
  }

  // SC auto-advance transitions
  addTransition('POSTED', 'SC', 'RECEIVED')
  addTransition('RECEIVED', 'SC', 'IN_PROGRESS')
  addTransition('IN_PROGRESS', 'SC', 'COMPLETED')

  // ABORT and STOP from opaque active states
  const opaqueActive = ['POSTED', 'RECEIVED', 'IN_PROGRESS']
  for (const state of opaqueActive) {
    addTransition(state, 'ABORT', 'ABORTING')
    addTransition(state, 'STOP', 'STOPPING')
  }

  return table
}

// ============================================================
// Exported transition tables
// ============================================================

/** Observable state transition table: (fromState, command) -> toState */
export const TRANSITION_TABLE: Map<string, Map<string, string>> = buildTransitionTable()

/** Opaque state transition table: (fromState, command) -> toState */
export const OPAQUE_TRANSITION_TABLE: Map<
  string,
  Map<string, string>
> = buildOpaqueTransitionTable()

/**
 * Auto-advance map for observable states.
 * Maps each state to its SC-triggered next state.
 * States not in this map have no auto-advance (PAUSED, HELD, COMPLETED, ABORTED, etc.).
 */
export const AUTO_ADVANCE: Map<string, string> = new Map([
  ['STARTING', 'EXECUTING'],
  ['EXECUTING', 'COMPLETING'],
  ['COMPLETING', 'COMPLETED'],
  ['PAUSING', 'PAUSED'],
  ['UNPAUSING', 'EXECUTING'],
  ['HOLDING', 'HELD'],
  ['UNHOLDING', 'EXECUTING'],
  ['ABORTING', 'ABORTED'],
  ['STOPPING', 'COMPLETED'],
  ['CLEARING', 'COMPLETED'],
])

/**
 * Auto-advance map for opaque states.
 * Maps each opaque state to its SC-triggered next state.
 */
export const OPAQUE_AUTO_ADVANCE: Map<string, string> = new Map([
  ['POSTED', 'RECEIVED'],
  ['RECEIVED', 'IN_PROGRESS'],
  ['IN_PROGRESS', 'COMPLETED'],
])

// ============================================================
// Command validation
// ============================================================

/**
 * Validate a command against the transition table for the given state.
 * Returns the target state if valid.
 * Throws InvalidStateTransitionError if the command is not valid for the current state.
 */
export function validateCommand(
  currentState: string,
  command: string,
  visibility: 'observable' | 'opaque'
): string {
  const table = visibility === 'opaque' ? OPAQUE_TRANSITION_TABLE : TRANSITION_TABLE
  const stateTransitions = table.get(currentState)

  if (!stateTransitions) {
    throw new InvalidStateTransitionError(currentState, command)
  }

  const targetState = stateTransitions.get(command)
  if (targetState === undefined) {
    throw new InvalidStateTransitionError(currentState, command)
  }

  return targetState
}
