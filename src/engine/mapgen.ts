// Deterministic procedural terrain. Two channels of fractal value-noise drive
// it: an elevation field (which also feeds the crit rule) and a forest field.
// A threshold "feature pass" turns those continuous fields into discrete
// terrain ids. The mapping of thresholds -> terrain ids lives in config, not in
// this algorithm, so which ids exist stays a data concern.
//
// Noise is hashed from (x, y, seed) rather than drawn from the Rng stream: it
// must be positionally addressable (sample any tile independently) and stay
// reproducible across machines. Same seed => identical map, always.

import type { Grid, Tile } from './types'

export interface MapGenConfig {
  width: number
  height: number
  /** Elevation below this (0..1) becomes water. */
  waterLevel: number
  /** Elevation above this (0..1) becomes an impassable peak/wall. */
  mountainLevel: number
  /** Forest-noise threshold (0..1); higher => sparser forest. */
  forestThreshold: number
  terrainIds: {
    water: string
    wall: string
    forest: string
    plain: string
  }
}

export const DEFAULT_MAPGEN: MapGenConfig = {
  width: 20,
  height: 15,
  waterLevel: 0.28,
  mountainLevel: 0.8,
  forestThreshold: 0.55,
  terrainIds: { water: 'water', wall: 'wall', forest: 'forest', plain: 'plain' },
}

// 32-bit integer hash of a lattice point. Position-addressable and seed-mixed.
function hash2(ix: number, iy: number, seed: number): number {
  let h = (seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t: number): number => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// Value noise: bilinearly interpolate hashed lattice values with smoothstep.
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)
  const v00 = hash2(x0, y0, seed)
  const v10 = hash2(x0 + 1, y0, seed)
  const v01 = hash2(x0, y0 + 1, seed)
  const v11 = hash2(x0 + 1, y0 + 1, seed)
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy)
}

// A couple of octaves so the field has both broad landmasses and local texture.
function fractalNoise(x: number, y: number, seed: number): number {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < 3; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

/** Quantise continuous elevation into discrete levels the crit rule can read. */
function elevationLevel(n: number): number {
  if (n < 0.33) return 0
  if (n < 0.66) return 1
  return 2
}

export function generateMap(seed: number, config: MapGenConfig = DEFAULT_MAPGEN): Grid {
  const { width, height, terrainIds } = config
  // Scale so the ~20-wide board spans a few noise cells: broad regions, not
  // per-tile static.
  const scale = 5.5
  const tiles: Tile[] = new Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = fractalNoise(x / scale, y / scale, seed)
      const f = fractalNoise(x / scale + 100, y / scale + 100, seed ^ 0x9e3779b9)

      let terrain: string
      if (e < config.waterLevel) terrain = terrainIds.water
      else if (e > config.mountainLevel) terrain = terrainIds.wall
      else if (f > config.forestThreshold) terrain = terrainIds.forest
      else terrain = terrainIds.plain

      tiles[y * width + x] = { x, y, elevation: elevationLevel(e), terrain }
    }
  }

  return { width, height, tiles }
}
