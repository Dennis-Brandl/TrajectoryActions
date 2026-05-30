import type { Instance } from '@trajectory/storage'

// ============================================================
// SseEvent — wire format for every Server-Sent Event
// ============================================================

export interface SseEvent {
  id: number
  type: 'state_change' | 'output' | 'log' | 'heartbeat' | 'property'
  data: Record<string, unknown>
}

// ============================================================
// Private per-instance bus
// ============================================================

interface InstanceBus {
  buffer: SseEvent[]
  nextId: number
  listeners: Set<(event: SseEvent) => void>
  heartbeatTimer: NodeJS.Timeout
  terminalTimer?: NodeJS.Timeout
}

// ============================================================
// Constants
// ============================================================

const BUFFER_SIZE = 256
const HEARTBEAT_MS = 30_000
const TERMINAL_LINGER_MS = 7_000

// ============================================================
// SseManager — per-instance event bus with ring buffer and heartbeat
// ============================================================

export class SseManager {
  private readonly buses = new Map<string, InstanceBus>()

  // --------------------------------------------------------
  // Private: bus lifecycle
  // --------------------------------------------------------

  private getOrCreateBus(instanceId: string): InstanceBus {
    const existing = this.buses.get(instanceId)
    if (existing) return existing

    const bus: InstanceBus = {
      buffer: [],
      nextId: 0,
      listeners: new Set(),
      heartbeatTimer: setInterval(() => {
        this.publish(instanceId, 'heartbeat', { timestamp: new Date().toISOString() })
      }, HEARTBEAT_MS),
    }

    this.buses.set(instanceId, bus)
    return bus
  }

  // --------------------------------------------------------
  // Public: publish helpers
  // --------------------------------------------------------

  /**
   * Publish a raw event to the instance bus.
   * Creates the bus if it doesn't exist yet.
   */
  publish(instanceId: string, type: SseEvent['type'], data: Record<string, unknown>): void {
    const bus = this.getOrCreateBus(instanceId)
    const event: SseEvent = {
      id: bus.nextId++,
      type,
      data,
    }

    // Ring buffer: drop oldest if full
    bus.buffer.push(event)
    if (bus.buffer.length > BUFFER_SIZE) {
      bus.buffer.shift()
    }

    // Notify all active listeners
    for (const listener of bus.listeners) {
      listener(event)
    }
  }

  /**
   * Publish a state_change event. If the instance has output_parameters,
   * also publish an output event with the current outputs.
   */
  publishStateChange(
    instanceId: string,
    state: string,
    previousState: string | null,
    instance: Instance
  ): void {
    this.publish(instanceId, 'state_change', {
      instance_id: instanceId,
      state,
      previous_state: previousState,
      timestamp: new Date().toISOString(),
    })

    // Publish output event if outputs are non-empty
    const outputs = instance.output_parameters as unknown[]
    if (outputs && outputs.length > 0) {
      this.publish(instanceId, 'output', {
        instance_id: instanceId,
        outputs,
        timestamp: new Date().toISOString(),
      })
    }
  }

  /**
   * Publish terminal state: emits state_change, stops heartbeat,
   * schedules bus cleanup after TERMINAL_LINGER_MS.
   */
  publishTerminal(
    instanceId: string,
    state: string,
    previousState: string | null,
    instance: Instance
  ): void {
    this.publishStateChange(instanceId, state, previousState, instance)

    const bus = this.buses.get(instanceId)
    if (!bus) return

    // Stop heartbeat
    clearInterval(bus.heartbeatTimer)

    // Schedule bus deletion after linger period
    bus.terminalTimer = setTimeout(() => {
      this.buses.delete(instanceId)
    }, TERMINAL_LINGER_MS)
  }

  /**
   * Publish an error as a log event on stderr stream.
   */
  publishError(instanceId: string, message: string): void {
    this.publish(instanceId, 'log', {
      instance_id: instanceId,
      stream: 'stderr',
      message,
      timestamp: new Date().toISOString(),
    })
  }

  // --------------------------------------------------------
  // Public: subscription
  // --------------------------------------------------------

  /**
   * Subscribe to events for a specific instance.
   * Returns an unsubscribe function.
   */
  subscribe(instanceId: string, listener: (event: SseEvent) => void): () => void {
    const bus = this.getOrCreateBus(instanceId)
    bus.listeners.add(listener)

    return () => {
      bus.listeners.delete(listener)
    }
  }

  /**
   * Return all buffered events after the given event id (for SSE reconnection replay).
   */
  getEventsSince(instanceId: string, afterId: number): SseEvent[] {
    const bus = this.buses.get(instanceId)
    if (!bus) return []
    return bus.buffer.filter((e) => e.id > afterId)
  }

  // --------------------------------------------------------
  // Property buses (per env_oid + property_name)
  // --------------------------------------------------------

  private readonly propertyBuses = new Map<
    string,
    {
      buffer: SseEvent[]
      nextId: number
      listeners: Set<(event: SseEvent) => void>
      heartbeatTimer: NodeJS.Timeout
    }
  >()

  private propertyKey(envOid: string, propertyName: string): string {
    return `${envOid}::${propertyName}`
  }

  private getOrCreatePropertyBus(envOid: string, propertyName: string) {
    const key = this.propertyKey(envOid, propertyName)
    const existing = this.propertyBuses.get(key)
    if (existing) return existing
    const bus = {
      buffer: [] as SseEvent[],
      nextId: 0,
      listeners: new Set<(event: SseEvent) => void>(),
      heartbeatTimer: setInterval(() => {
        const ev: SseEvent = {
          id: bus.nextId++,
          type: 'heartbeat',
          data: { timestamp: new Date().toISOString() },
        }
        bus.buffer.push(ev)
        if (bus.buffer.length > BUFFER_SIZE) bus.buffer.shift()
        for (const l of bus.listeners) l(ev)
      }, HEARTBEAT_MS),
    }
    this.propertyBuses.set(key, bus)
    return bus
  }

  publishProperty(
    envOid: string,
    propertyName: string,
    data: {
      entries: Array<{ name: string; value: string }>
      changed_entries: string[]
      source: 'action_code'
      source_action_oid?: string
      source_instance_id?: string
    }
  ): void {
    const bus = this.getOrCreatePropertyBus(envOid, propertyName)
    const event: SseEvent = {
      id: bus.nextId++,
      type: 'property',
      data: {
        environment_oid: envOid,
        property_name: propertyName,
        ...data,
        timestamp: new Date().toISOString(),
      },
    }
    bus.buffer.push(event)
    if (bus.buffer.length > BUFFER_SIZE) bus.buffer.shift()
    for (const l of bus.listeners) l(event)
  }

  subscribeProperty(
    envOid: string,
    propertyName: string,
    listener: (event: SseEvent) => void
  ): () => void {
    const bus = this.getOrCreatePropertyBus(envOid, propertyName)
    bus.listeners.add(listener)
    return () => {
      bus.listeners.delete(listener)
    }
  }

  getPropertyEventsSince(envOid: string, propertyName: string, afterId: number): SseEvent[] {
    const bus = this.propertyBuses.get(this.propertyKey(envOid, propertyName))
    if (!bus) return []
    return bus.buffer.filter((e) => e.id > afterId)
  }

  destroyPropertyBuses(envOid: string): void {
    for (const [key, bus] of this.propertyBuses) {
      if (key.startsWith(`${envOid}::`)) {
        clearInterval(bus.heartbeatTimer)
        bus.listeners.clear()
        this.propertyBuses.delete(key)
      }
    }
  }

  /**
   * Immediately tear down the per-instance event bus: clears heartbeat + any
   * pending terminal-linger timer, drops every listener, and removes the bus
   * entry. Called by the management `DELETE /instances/:id` route so a
   * force-deleted instance leaves no lingering heartbeat or SSE subscribers
   * referencing a row that no longer exists. No-op if no bus is registered
   * (typical for terminal-then-linger-then-gc instances).
   */
  destroyInstanceBus(instanceId: string): void {
    const bus = this.buses.get(instanceId)
    if (!bus) return
    clearInterval(bus.heartbeatTimer)
    if (bus.terminalTimer) clearTimeout(bus.terminalTimer)
    bus.listeners.clear()
    this.buses.delete(instanceId)
  }

  // --------------------------------------------------------
  // Public: shutdown
  // --------------------------------------------------------

  /**
   * Clear all timers and buses (called on process shutdown).
   */
  shutdown(): void {
    for (const bus of this.buses.values()) {
      clearInterval(bus.heartbeatTimer)
      if (bus.terminalTimer) {
        clearTimeout(bus.terminalTimer)
      }
    }
    this.buses.clear()
    for (const bus of this.propertyBuses.values()) {
      clearInterval(bus.heartbeatTimer)
    }
    this.propertyBuses.clear()
  }
}
