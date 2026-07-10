// A minimal synchronous event bus. Subsystems emit GameEvents; the ability
// system (and, for narration, the UI/log) subscribe. Fan-out is synchronous and
// in registration order so that replay is deterministic — no microtask timing
// creeps into the simulation.

import type { GameEvent } from './types'

export type EventHandler = (event: GameEvent) => void

export interface EventBus {
  /** Subscribe; returns an unsubscribe function. */
  on(handler: EventHandler): () => void
  /** Deliver an event to all current subscribers, in registration order. */
  emit(event: GameEvent): void
}

export function makeEventBus(): EventBus {
  const handlers: EventHandler[] = []

  return {
    on(handler) {
      handlers.push(handler)
      return () => {
        const i = handlers.indexOf(handler)
        if (i >= 0) handlers.splice(i, 1)
      }
    },
    emit(event) {
      // Snapshot so a handler that (un)subscribes during dispatch can't perturb
      // this event's delivery set.
      for (const handler of handlers.slice()) handler(event)
    },
  }
}
