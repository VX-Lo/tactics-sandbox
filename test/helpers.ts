// Shared test scaffolding: build controlled boards and place units, so tests
// exercise one subsystem without dragging in map generation or full setup.

import type { BattleState, Coord, Grid, Unit } from '../src/engine/types'
import { defaultContent, instantiateUnit } from '../src/engine/content'

export const content = defaultContent

export function uniformGrid(width: number, height: number, terrain = 'plain'): Grid {
  const tiles = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) tiles.push({ x, y, elevation: 0, terrain })
  return { width, height, tiles }
}

export function setTerrain(grid: Grid, x: number, y: number, terrain: string): void {
  grid.tiles[y * grid.width + x].terrain = terrain
}

export function setElevation(grid: Grid, x: number, y: number, elevation: number): void {
  grid.tiles[y * grid.width + x].elevation = elevation
}

export function place(defId: string, id: string, pos: Coord): Unit {
  const u = instantiateUnit(content, defId, id)
  u.pos = { ...pos }
  return u
}

export function makeState(grid: Grid, units: Unit[]): BattleState {
  return { grid, units, turn: 1, phase: 'player', seed: 1, outcome: 'ongoing' }
}
