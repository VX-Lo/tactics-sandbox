import { describe, it, expect } from 'vitest'
import { makeRng } from '../src/engine/rng'

describe('rng', () => {
  it('is deterministic: same seed => same stream', () => {
    const a = makeRng(1234)
    const b = makeRng(1234)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces different streams for different seeds', () => {
    const a = makeRng(1)
    const b = makeRng(2)
    expect(a.next()).not.toEqual(b.next())
  })

  it('next() stays in [0, 1)', () => {
    const r = makeRng(99)
    for (let i = 0; i < 1000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('int() respects [min, max) bounds', () => {
    const r = makeRng(7)
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 8)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThan(8)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('range() is inclusive on both ends', () => {
    const r = makeRng(42)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(r.range(1, 3))
    expect(seen).toEqual(new Set([1, 2, 3]))
  })

  it('pick() throws on empty input', () => {
    const r = makeRng(0)
    expect(() => r.pick([])).toThrow()
  })

  it('snapshot advances with the stream', () => {
    const r = makeRng(555)
    const s0 = r.snapshot()
    r.next()
    expect(r.snapshot()).not.toEqual(s0)
  })
})
