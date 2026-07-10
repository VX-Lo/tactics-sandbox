import { describe, it, expect } from 'vitest'
import { generateMap, DEFAULT_MAPGEN } from '../src/engine/mapgen'

describe('map generation', () => {
  it('is deterministic: same seed => identical grid', () => {
    const a = generateMap(2026)
    const b = generateMap(2026)
    expect(a).toEqual(b)
  })

  it('different seeds produce different maps', () => {
    const a = generateMap(1)
    const b = generateMap(2)
    expect(a.tiles).not.toEqual(b.tiles)
  })

  it('respects configured dimensions', () => {
    expect(generateMap(1).width).toBe(20)
    expect(generateMap(1).height).toBe(15)
    expect(generateMap(1).tiles.length).toBe(20 * 15)
  })

  it('emits only known terrain ids and discrete elevation levels', () => {
    const ids = new Set(Object.values(DEFAULT_MAPGEN.terrainIds))
    for (const t of generateMap(7).tiles) {
      expect(ids.has(t.terrain)).toBe(true)
      expect([0, 1, 2]).toContain(t.elevation)
    }
  })

  it('produces terrain variety (not a uniform field)', () => {
    // Sample several seeds; across them we expect more than one terrain kind
    // to appear, i.e. the feature pass actually differentiates.
    const kinds = new Set<string>()
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const t of generateMap(seed).tiles) kinds.add(t.terrain)
    }
    expect(kinds.size).toBeGreaterThan(1)
  })
})
