import { describe, it, expect } from 'vitest'
import {
  idx,
  inBounds,
  tileAt,
  neighbors,
  manhattan,
  coordsEqual,
} from '../src/engine/grid'
import type { Grid } from '../src/engine/types'

function blankGrid(w: number, h: number): Grid {
  const tiles = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) tiles.push({ x, y, elevation: 0, terrain: 'plain' })
  return { width: w, height: h, tiles }
}

describe('grid helpers', () => {
  const g = blankGrid(4, 3)

  it('idx is row-major', () => {
    expect(idx(g, 0, 0)).toBe(0)
    expect(idx(g, 3, 2)).toBe(11)
  })

  it('inBounds rejects out-of-range coords', () => {
    expect(inBounds(g, 0, 0)).toBe(true)
    expect(inBounds(g, 3, 2)).toBe(true)
    expect(inBounds(g, 4, 0)).toBe(false)
    expect(inBounds(g, -1, 0)).toBe(false)
    expect(inBounds(g, 0, 3)).toBe(false)
  })

  it('tileAt returns undefined out of bounds', () => {
    expect(tileAt(g, 1, 1)?.x).toBe(1)
    expect(tileAt(g, 9, 9)).toBeUndefined()
  })

  it('neighbors returns in-bounds orthogonal cells in N/E/S/W order', () => {
    expect(neighbors(g, { x: 1, y: 1 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 1 },
    ])
    // Corner clips out-of-bounds directions.
    expect(neighbors(g, { x: 0, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ])
  })

  it('manhattan and coordsEqual', () => {
    expect(manhattan({ x: 0, y: 0 }, { x: 2, y: 3 })).toBe(5)
    expect(coordsEqual({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(true)
    expect(coordsEqual({ x: 1, y: 1 }, { x: 1, y: 2 })).toBe(false)
  })
})
