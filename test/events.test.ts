import { describe, it, expect } from 'vitest'
import { makeEventBus } from '../src/engine/events'
import type { GameEvent, Unit } from '../src/engine/types'

// A bare stand-in; the bus never inspects unit internals.
const stubUnit = { id: 'u1' } as unknown as Unit
const evt = (type: GameEvent['type']): GameEvent => ({ type, unit: stubUnit })

describe('event bus', () => {
  it('delivers events to all subscribers in registration order', () => {
    const bus = makeEventBus()
    const order: string[] = []
    bus.on(() => order.push('a'))
    bus.on(() => order.push('b'))
    bus.emit(evt('on_move'))
    expect(order).toEqual(['a', 'b'])
  })

  it('unsubscribe stops delivery', () => {
    const bus = makeEventBus()
    let count = 0
    const off = bus.on(() => count++)
    bus.emit(evt('on_move'))
    off()
    bus.emit(evt('on_move'))
    expect(count).toBe(1)
  })

  it('a handler that subscribes mid-dispatch does not receive the current event', () => {
    const bus = makeEventBus()
    let lateCalls = 0
    bus.on(() => {
      bus.on(() => lateCalls++)
    })
    bus.emit(evt('on_kill'))
    expect(lateCalls).toBe(0)
    bus.emit(evt('on_kill'))
    expect(lateCalls).toBe(1)
  })
})
