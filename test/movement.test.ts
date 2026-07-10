import { describe, it, expect } from 'vitest'
import {
  reachable,
  moveDestinations,
  reconstructPath,
  occupantAt,
} from '../src/engine/movement'
import { manhattan } from '../src/engine/grid'
import { content, uniformGrid, setTerrain, place, makeState } from './helpers'

describe('movement', () => {
  it('open field: reach equals the Manhattan diamond within the budget', () => {
    const grid = uniformGrid(11, 11) // all plain, cost 1
    const u = place('yuki', 'y1', { x: 5, y: 5 }) // move 4
    const state = makeState(grid, [u])
    const dests = moveDestinations(reachable(state, content, u), state, u)
    // Every tile with Manhattan distance <= 4 is reachable on cost-1 terrain.
    const expected = grid.tiles.filter((t) => manhattan(t, u.pos) <= 4).length
    expect(dests.length).toBe(expected)
    for (const d of dests) expect(manhattan(d, u.pos)).toBeLessThanOrEqual(4)
  })

  it('forest costs 2 to enter, shrinking reach', () => {
    const grid = uniformGrid(11, 11)
    // Wall of forest one tile east of the unit.
    for (let y = 0; y < 11; y++) setTerrain(grid, 6, y, 'forest')
    const u = place('yuki', 'y1', { x: 5, y: 5 }) // move 4
    const state = makeState(grid, [u])
    const reach = reachable(state, content, u)
    // Entering the forest tile at (6,5) costs 2, not 1.
    expect(reach.costs.get('6,5')).toBe(2)
  })

  it('impassable terrain blocks movement', () => {
    const grid = uniformGrid(11, 11)
    setTerrain(grid, 6, 5, 'water') // impassable
    const u = place('aoi', 'a1', { x: 5, y: 5 })
    const state = makeState(grid, [u])
    const reach = reachable(state, content, u)
    expect(reach.costs.has('6,5')).toBe(false)
  })

  it('enemies block passage; allies can be passed but not stopped on', () => {
    const grid = uniformGrid(11, 11)
    const mover = place('aoi', 'a1', { x: 5, y: 5 }) // move 7
    const ally = place('hana', 'h1', { x: 6, y: 5 })
    const enemy = place('skeleton', 's1', { x: 5, y: 6 })
    const state = makeState(grid, [mover, ally, enemy])
    const reach = reachable(state, content, mover)
    const dests = new Set(moveDestinations(reach, state, mover).map((c) => `${c.x},${c.y}`))

    // Can path THROUGH the ally to the tile beyond, but not stop on the ally.
    expect(reach.costs.has('7,5')).toBe(true)
    expect(dests.has('6,5')).toBe(false)
    expect(dests.has('7,5')).toBe(true)
    // The enemy tile is unreachable entirely.
    expect(reach.costs.has('5,6')).toBe(false)
  })

  it('reconstructPath yields a contiguous orthogonal path from start to target', () => {
    const grid = uniformGrid(11, 11)
    const u = place('aoi', 'a1', { x: 2, y: 2 })
    const state = makeState(grid, [u])
    const reach = reachable(state, content, u)
    const path = reconstructPath(reach, { x: 5, y: 3 })
    expect(path).not.toBeNull()
    expect(path![0]).toEqual({ x: 2, y: 2 })
    expect(path![path!.length - 1]).toEqual({ x: 5, y: 3 })
    for (let i = 1; i < path!.length; i++)
      expect(manhattan(path![i], path![i - 1])).toBe(1)
  })

  it('occupantAt finds the living unit on a tile', () => {
    const grid = uniformGrid(5, 5)
    const u = place('hana', 'h1', { x: 2, y: 2 })
    const state = makeState(grid, [u])
    expect(occupantAt(state, 2, 2)?.id).toBe('h1')
    expect(occupantAt(state, 0, 0)).toBeUndefined()
  })
})
