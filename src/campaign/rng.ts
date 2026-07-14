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

/** Deterministic 31-bit hash of a string (FNV-1a). Used to derive a STABLE
 *  per-node terrain seed for a BattleRequest — the same place always fights on
 *  the same ground, independent of the battle's own draw. Not for gameplay RNG. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 0x7fffffff
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
