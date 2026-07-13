// The campaign's OWN seeded PRNG — deliberately not imported from the tactics
// engine, so the campaign module depends on nothing in src/engine. Same
// mulberry32 algorithm the engine uses (tiny, portable, reproducible across
// machines): it is the campaign's determinism spine. `Math.random` is banned
// here exactly as it is in the engine.

export interface CampaignRng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number
  /** A fresh 31-bit seed for a sub-system (e.g. one battle), drawn from the stream. */
  nextSeed(): number
}

export function makeCampaignRng(seed: number): CampaignRng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min))

  return {
    next,
    int,
    nextSeed: () => int(0, 0x7fffffff),
  }
}
