/// <reference types="vite/client" />
// Culture-specific name pools for levy→named promotion (identity genesis).
//
// Pools are flat text files under `names/`, one per (species, gender), named
// `{species}_{gender}.txt`, one name per line. The resolver selects a pool by
// (species, gender); only `elf_female` is populated today, but the shape is
// per-cell so other cultures slot in by dropping a file — no code change.
//
// Determinism contract (this is replay-load-bearing):
//   * Each pool is shuffled ONCE at run start, using a sub-seed derived from
//     BOTH the run seed AND the pool key. Every pool therefore has an
//     independent draw order, so populating other pools later cannot change the
//     order of an existing one and cannot break an existing replay.
//   * The shuffle is a permutation of the file's line order, so the *contents
//     and order* of each `names/*.txt` are part of the replay contract: editing
//     a pool file changes which names a given seed draws. Treat these files like
//     data, not prose.
//   * Draws are sequential from the shuffled pool; on exhaustion we fall back to
//     a stable, unique `Unnamed-{stableUnitId}`.
// All randomness routes through the engine's seeded PRNG — no wall-clock, no
// unseeded shuffle, no new dependency.

import { makeRng, type Rng } from '../engine/rng'

// Vite/Vitest bundle every pool file as a raw string at build time. Dropping a
// new `names/*.txt` file is picked up here automatically; the glob order is
// deterministic (sorted by path) but irrelevant — each pool is keyed and
// shuffled from its own independent sub-seed.
const POOL_FILES = import.meta.glob('../../names/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Parse the bundled files into poolKey -> names[] (file line order preserved). */
function loadPools(): Map<string, string[]> {
  const pools = new Map<string, string[]>()
  for (const [path, content] of Object.entries(POOL_FILES)) {
    const key = path.replace(/^.*\//, '').replace(/\.txt$/, '')
    const names = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    pools.set(key, names)
  }
  return pools
}

// FNV-1a over the pool key, with the run seed standing in for the offset basis,
// so each (run, pool) pair gets an independent 32-bit sub-seed. Pure integer
// math → portable and reproducible across machines.
function poolSubSeed(runSeed: number, poolKey: string): number {
  let h = runSeed >>> 0
  for (let i = 0; i < poolKey.length; i++) {
    h ^= poolKey.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** In-place Fisher–Yates using the seeded PRNG. */
function shuffle<T>(rng: Rng, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1)
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
}

/** Build the pool key for a (species, gender) cell — the file-naming convention. */
export function poolKey(species: string, gender: string): string {
  return `${species}_${gender}`
}

/**
 * Per-run name draw. Constructed once per run with the run seed; shuffles every
 * pool up front (independent orders) and hands out names sequentially. Draw
 * state (per-pool cursor) is part of the run's evolving state — replaying the
 * same seed reproduces the same shuffles and therefore the same name sequence.
 */
export class NameRegistry {
  private readonly pools = new Map<string, string[]>()
  private readonly cursor = new Map<string, number>()

  constructor(runSeed: number) {
    for (const [key, names] of loadPools()) {
      const shuffled = names.slice()
      shuffle(makeRng(poolSubSeed(runSeed, key)), shuffled)
      this.pools.set(key, shuffled)
      this.cursor.set(key, 0)
    }
  }

  /**
   * Draw the next name for a promoting unit of this (species, gender). Advances
   * the pool cursor only on a successful draw; on an empty/exhausted pool falls
   * back to a stable, unique `Unnamed-{stableUnitId}`.
   */
  draw(species: string, gender: string, stableUnitId: string): string {
    const key = poolKey(species, gender)
    const pool = this.pools.get(key)
    const at = this.cursor.get(key) ?? 0
    if (!pool || at >= pool.length) return `Unnamed-${stableUnitId}`
    this.cursor.set(key, at + 1)
    return pool[at]
  }
}
