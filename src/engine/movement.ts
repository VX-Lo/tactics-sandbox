// Spatial reasoning only: where can a unit go, along what path, at what cost.
// It reads terrain costs and unit occupancy but never mutates the world and
// never emits events — battle orchestration owns those. That separation is what
// lets the crit/combat/ability systems ignore how movement is computed.
//
// Rules (Fire Emblem lineage):
//  - Movement is 4-directional; entering a tile costs the terrain's move cost
//    (or a unit's per-terrain override).
//  - Impassable terrain (water, crag) blocks entry and passage.
//  - Enemy units block both entry and passage. Allied units may be passed
//    through but cannot be stopped on.

import type { BattleState, Content, Coord, Unit } from './types'
import { neighbors, terrainAt } from './grid'

const key = (x: number, y: number): string => `${x},${y}`
const parseKey = (s: string): Coord => {
  const [x, y] = s.split(',').map(Number)
  return { x, y }
}

/** First living unit standing on a tile, if any. */
export function occupantAt(state: BattleState, x: number, y: number): Unit | undefined {
  return state.units.find((u) => u.alive && u.pos.x === x && u.pos.y === y)
}

/** Movement points to ENTER a tile, honouring any per-unit terrain override. */
export function moveCostFor(unit: Unit, terrainId: string, baseCost: number): number {
  return unit.movement.terrainCosts?.[terrainId] ?? baseCost
}

export interface Reach {
  from: Coord
  /** "x,y" -> minimum cost to reach (includes tiles only passable-through). */
  costs: Map<string, number>
  /** "x,y" -> predecessor key, for path reconstruction. */
  prev: Map<string, string>
}

/**
 * Dijkstra over the move budget. Grids are tiny (~300 tiles), so a linear-scan
 * frontier is more than fast enough and keeps expansion order deterministic.
 * Returned costs include ally tiles that can be traversed but not stopped on;
 * use moveDestinations to get the legal stopping tiles.
 */
export function reachable(state: BattleState, content: Content, unit: Unit): Reach {
  const { grid } = state
  const start = unit.pos
  const startKey = key(start.x, start.y)
  const costs = new Map<string, number>([[startKey, 0]])
  const prev = new Map<string, string>()
  const visited = new Set<string>()

  for (;;) {
    let curKey: string | undefined
    let curCost = Infinity
    for (const [k, c] of costs) {
      if (!visited.has(k) && c < curCost) {
        curCost = c
        curKey = k
      }
    }
    if (curKey === undefined) break
    visited.add(curKey)

    const cur = parseKey(curKey)
    for (const nb of neighbors(grid, cur)) {
      const terrain = terrainAt(grid, content.terrain, nb.x, nb.y)
      if (!terrain.passable) continue
      const occ = occupantAt(state, nb.x, nb.y)
      if (occ && occ.faction !== unit.faction) continue // enemy blocks entry and passage
      const nc = curCost + moveCostFor(unit, terrain.id, terrain.moveCost)
      if (nc > unit.movement.points) continue
      const nk = key(nb.x, nb.y)
      const existing = costs.get(nk)
      if (existing === undefined || nc < existing) {
        costs.set(nk, nc)
        prev.set(nk, curKey)
      }
    }
  }

  return { from: start, costs, prev }
}

/** True if `unit` may END its move on (x,y): reachable, empty (or its own tile). */
export function canStopAt(state: BattleState, unit: Unit, x: number, y: number): boolean {
  const occ = occupantAt(state, x, y)
  return !occ || occ.id === unit.id
}

/** The legal stopping tiles from a Reach result (includes staying in place). */
export function moveDestinations(reach: Reach, state: BattleState, unit: Unit): Coord[] {
  const out: Coord[] = []
  for (const k of reach.costs.keys()) {
    const c = parseKey(k)
    if (canStopAt(state, unit, c.x, c.y)) out.push(c)
  }
  return out
}

/**
 * Reconstruct the step-by-step path from the unit's start to a target tile,
 * inclusive of both ends, or null if the target was not reached.
 */
export function reconstructPath(reach: Reach, target: Coord): Coord[] | null {
  const targetKey = key(target.x, target.y)
  if (!reach.costs.has(targetKey)) return null
  const path: Coord[] = []
  let cur: string | undefined = targetKey
  while (cur !== undefined) {
    path.push(parseKey(cur))
    cur = reach.prev.get(cur)
  }
  return path.reverse()
}
