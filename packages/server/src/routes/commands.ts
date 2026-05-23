import { Router } from 'express'
import type { InstanceManager } from '@trajectory/engine'
import type { SseManager, SseEvent } from '../sse-manager.js'
import { formatSseEvent } from '../sse-utils.js'
import { validateBody } from '../validation.js'

// ============================================================
// Constants
// ============================================================

const VALID_COMMANDS = new Set(['PAUSE', 'RESUME', 'HOLD', 'UNHOLD', 'ABORT', 'STOP', 'CLEAR'])

// ============================================================
// Commands router factory
// ============================================================

/**
 * createCommandsRouter — Express Router with command and SSE streaming endpoints.
 *
 * Endpoints:
 *   POST /instances/:id/command   — REST-05: send state command to instance
 *   GET  /instances/:id/events    — REST-06/07: SSE event stream with Last-Event-ID reconnection
 */
export function createCommandsRouter(manager: InstanceManager, sseManager: SseManager): Router {
  const router = Router()

  // --------------------------------------------------------
  // REST-05: POST /instances/:id/command
  // --------------------------------------------------------
  router.post('/instances/:id/command', async (req, res, next) => {
    const instanceId = req.params.id as string
    // Validate body — only 'command' field allowed
    const validationResult = validateBody(req.body, {
      command: { required: true, type: 'string' },
    })

    if (!validationResult.valid) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: validationResult.message,
          details: {},
        },
      })
      return
    }

    const { command } = validationResult.data as { command: string }

    // Validate the command value itself
    if (!VALID_COMMANDS.has(command)) {
      res.status(422).json({
        error: {
          code: 'INVALID_COMMAND',
          message: `Unknown command: ${command}`,
          details: { command },
        },
      })
      return
    }

    // Check instance exists
    const instance = manager.getInstance(instanceId)
    if (!instance) {
      res.status(404).json({
        error: {
          code: 'INSTANCE_NOT_FOUND',
          message: 'Instance not found',
          details: {},
        },
      })
      return
    }

    try {
      await manager.sendCommand(instanceId, command)

      res.status(200).json({
        data: {
          instance_id: instanceId,
          command,
          accepted: true,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // REST-06/07: GET /instances/:id/events (SSE)
  // --------------------------------------------------------
  router.get('/instances/:id/events', (req, res) => {
    const instanceId = req.params.id as string

    // Check instance exists
    const instance = manager.getInstance(instanceId)
    if (!instance) {
      return void res.status(404).json({
        error: {
          code: 'INSTANCE_NOT_FOUND',
          message: 'Instance not found',
          details: {},
        },
      })
    }

    // Set SSE headers and flush immediately
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()

    // Replay missed events from ring buffer if Last-Event-ID provided
    const lastEventIdHeader = req.headers['last-event-id']
    const lastEventId = lastEventIdHeader ? Number(lastEventIdHeader) : 0
    const missed = sseManager.getEventsSince(instanceId, lastEventId)
    for (const event of missed) {
      if (!res.writableEnded) {
        res.write(formatSseEvent(event))
      }
    }

    // Subscribe to new events
    const unsubscribe = sseManager.subscribe(instanceId, (event: SseEvent) => {
      if (!res.writableEnded) {
        res.write(formatSseEvent(event))
      }
    })

    // Clean up on client disconnect
    req.on('close', () => {
      unsubscribe()
    })
  })

  return router
}
