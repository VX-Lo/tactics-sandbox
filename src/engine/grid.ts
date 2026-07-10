// Pure geometry helpers over a Grid. No knowledge of units, combat, or
// generation — just "what tile is here, what's adjacent, how far apart". The
// grid uses 4-directional (orthogonal) adjacency: movement, range, and the
// elevation crit rule all speak the same Manhattan language.

import type { Coord, Grid, TerrainDef, Tile } from './types'

export function idx(grid: Grid, x: number, y: number): number {
  return y * grid.width + x
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height
}

export function tileAt(grid: Grid, x: number, y: number): Tile | undefined {
  return inBounds(grid, x, y) ? grid.tiles[idx(grid, x, y)] : undefined
}

/** Resolve a tile's terrain definition through the content registry. */
export function terrainAt(
  grid: Grid,
  terrain: Record<string, TerrainDef>,
  x: number,
  y: number,
): TerrainDef {
  const tile = tileAt(grid, x, y)
  if (!tile) throw new Error(`terrainAt: out of bounds (${x},${y})`)
  const def = terrain[tile.terrain]
  if (!def) throw new Error(`Unknown terrain id "${tile.terrain}" at (${x},${y})`)
  return def
}

const ORTHOGONAL: ReadonlyArray<Coord> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]

/** In-bounds orthogonal neighbours, in N/E/S/W order (deterministic). */
export function neighbors(grid: Grid, c: Coord): Coord[] {
  const out: Coord[] = []
  for (const d of ORTHOGONAL) {
    const x = c.x + d.x
    const y = c.y + d.y
    if (inBounds(grid, x, y)) out.push({ x, y })
  }
  return out
}

export function manhattan(a: Coord, b: Coord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

export function coordsEqual(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y
}
