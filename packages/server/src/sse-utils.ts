import type { SseEvent } from './sse-manager.js'

/**
 * Format a single SSE event into the on-the-wire frame string.
 * Output ends with a double-newline frame terminator.
 */
export function formatSseEvent(event: SseEvent): string {
  return `event: ${event.type}\nid: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`
}
