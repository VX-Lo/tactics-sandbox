// The single source of randomness for the whole simulation. Every stochastic
// decision (hit, crit, ability picks, map noise) draws from an Rng seeded once
// per battle. This is the load-bearing piece of the determinism guarantee:
// same seed + same inputs => byte-identical outcome. `Math.random` is banned
// in engine code precisely because it would route around this.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number
  /** Integer in [minInclusive, maxInclusive]. */
  range(minInclusive: number, maxInclusive: number): number
  /** True with the given probability (0..1). */
  chance(probability: number): boolean
  /** Uniformly pick one element; throws on empty input. */
  pick<T>(items: readonly T[]): T
  /** Current internal state, for snapshotting a battle mid-stream. */
  snapshot(): number
}

// mulberry32: a tiny, fast, well-distributed 32-bit PRNG. Chosen over the
// engine's own scheme because it is trivially portable and reproducible across
// machines — no reliance on platform float behaviour beyond IEEE-754.
export function makeRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number): number =>
    min + Math.floor(next() * (max - min))

  return {
    next,
    int,
    range: (min, max) => int(min, max + 1),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('Rng.pick on empty array')
      return items[int(0, items.length)]
    },
    snapshot: () => state >>> 0,
  }
}
