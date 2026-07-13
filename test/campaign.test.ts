import { describe, it, expect } from 'vitest'
import { Campaign } from '../src/campaign/campaign'
import { autoResolve } from '../src/campaign/resolve'
import { loadWorld, defaultWorld } from '../src/campaign/world'

// A tiny, fully-controlled fixture world so defense values and distances are
// exact. Layout coords are arbitrary (presentation only).
//   home(player,10) --1-- town(neutral,3) --1-- fort(neutral,99)
//        town --5-- keep(raiders,10) --1-- outpost(neutral,2)
const FIXTURE = {
  factions: [
    { id: 'player', name: 'Elves', color: '#0f0' },
    { id: 'raiders', name: 'Raiders', color: '#f0f' },
    { id: 'neutral', name: 'Free', color: '#888' },
  ],
  nodes: [
    { id: 'home', name: 'Home', kind: 'settlement', owner: 'player', defense: 10, x: 0, y: 0 },
    { id: 'town', name: 'Town', kind: 'settlement', owner: 'neutral', defense: 3, x: 1, y: 0 },
    { id: 'fort', name: 'Fort', kind: 'settlement', owner: 'neutral', defense: 99, x: 2, y: 0 },
    { id: 'keep', name: 'Keep', kind: 'settlement', owner: 'raiders', defense: 10, x: 3, y: 0 },
    { id: 'outpost', name: 'Outpost', kind: 'settlement', owner: 'neutral', defense: 2, x: 3, y: 1 },
  ],
  edges: [
    { a: 'home', b: 'town', cost: 1 },
    { a: 'town', b: 'fort', cost: 1 },
    { a: 'town', b: 'keep', cost: 5 },
    { a: 'keep', b: 'outpost', cost: 1 },
  ],
  parties: [
    { id: 'player', faction: 'player', start: 'home', strength: 5 },
    { id: 'raider', faction: 'raiders', start: 'keep', strength: 5 },
  ],
}
const fixtureCampaign = (seed: number) => new Campaign(loadWorld(FIXTURE), seed)

// --- pillar 6: the resolveBattle stub & the variance rule ------------------

describe('resolveBattle stub — the variance rule', () => {
  it('the stronger side ALWAYS wins; the seed never decides a non-tie', () => {
    for (let seed = 0; seed < 300; seed++) {
      expect(autoResolve({ strength: 10 }, { strength: 6 }, seed).winner).toBe('attacker')
      expect(autoResolve({ strength: 4 }, { strength: 9 }, seed).winner).toBe('defender')
    }
  })

  it('the seed varies only the MARGIN (victor casualties), never the winner', () => {
    const deltas = new Set<number>()
    for (let seed = 0; seed < 50; seed++) deltas.add(autoResolve({ strength: 10 }, { strength: 8 }, seed).attackerDelta)
    expect(deltas.size).toBeGreaterThan(1) // casualties differ across seeds
    // Victor always survives (>= 1); the loser is fully spent.
    for (let seed = 0; seed < 50; seed++) {
      const o = autoResolve({ strength: 10 }, { strength: 6 }, seed)
      expect(10 + o.attackerDelta).toBeGreaterThanOrEqual(1)
      expect(o.defenderDelta).toBe(-6)
    }
  })

  it('equal strength is the ONLY case the seed may decide the winner', () => {
    const winners = new Set<string>()
    for (let seed = 0; seed < 100; seed++) winners.add(autoResolve({ strength: 7 }, { strength: 7 }, seed).winner)
    expect(winners).toEqual(new Set(['attacker', 'defender'])) // both outcomes occur
  })
})

// --- determinism / replay --------------------------------------------------

describe('campaign — determinism & replay', () => {
  // A scripted campaign that resolves the player's own battle (takes town), so
  // the seed genuinely bites on margins. The rival's moves are economy-gated
  // now (see economy.ts) and not asserted on here — just replayed identically.
  const play = (seed: number) => {
    const c = fixtureCampaign(seed)
    c.turn({ op: 'travel', dest: 'town' }) // player home -> town
    c.turn({ op: 'capture' }) // player takes town
    c.turn({ op: 'wait' })
    return c
  }

  it('same seed + same orders => byte-identical campaign', () => {
    expect(play(2026).snapshot()).toEqual(play(2026).snapshot())
  })

  it('reused world data does not leak state between campaigns', () => {
    play(2026) // mutating one campaign...
    expect(play(2026).snapshot()).toEqual(play(2026).snapshot()) // ...must not affect the next
  })

  it('the seed changes battle margins (party strengths diverge)', () => {
    const strengths = new Set<number>()
    for (let seed = 0; seed < 30; seed++) strengths.add(play(seed).playerParty()!.strength)
    expect(strengths.size).toBeGreaterThan(1)
  })

  it('the default world replays byte-identically over a multi-hop journey', () => {
    const run = (seed: number) => {
      const c = new Campaign(defaultWorld, seed)
      c.turn({ op: 'travel', dest: 'rootholm' }) // deepwood -> crossbrook
      c.turn({ op: 'travel', dest: 'rootholm' }) // crossbrook -> rootholm
      c.turn({ op: 'capture' }) // take rootholm (def 5 < str 10)
      c.turn({ op: 'wait' })
      c.turn({ op: 'wait' })
      return c.snapshot()
    }
    expect(run(2026)).toEqual(run(2026))
  })
})

// --- pillar 4: ownership / territory ---------------------------------------

describe('campaign — ownership & territory', () => {
  it('capturing flips the owner, persists, and updates the owned count', () => {
    const c = fixtureCampaign(1)
    expect(c.ownedCount('player')).toBe(1) // home
    c.turn({ op: 'travel', dest: 'town' })
    c.turn({ op: 'capture' })
    expect(c.ownerOf('town')).toBe('player') // flipped
    expect(c.ownedCount('player')).toBe(2)
    c.turn({ op: 'wait' })
    expect(c.ownerOf('town')).toBe('player') // persists
  })

  it('the rival flips a settlement with no player involvement', () => {
    const c = fixtureCampaign(1)
    // The rival's spending policy holds while Scrip builds toward the expand
    // threshold and its reaction lag clears (see economy.ts); only then does
    // it march keep -> outpost and, arriving, assault it. No hardcoded turn
    // count here — jitter on income can shift exactly when that lands.
    for (let i = 0; i < 15 && c.ownerOf('outpost') !== 'raiders'; i++) c.turn({ op: 'wait' })
    expect(c.ownerOf('outpost')).toBe('raiders')
    expect(c.ownedCount('raiders')).toBe(2) // keep + outpost
  })
})

// --- the loop: time, removal, persistence ----------------------------------

describe('campaign — loop mechanics', () => {
  it('travel advances the clock by the edge cost; nothing else does', () => {
    const c = fixtureCampaign(1)
    expect(c.clock).toBe(0)
    c.turn({ op: 'travel', dest: 'town' }) // cost 1
    expect(c.clock).toBe(1)
    c.turn({ op: 'travel', dest: 'fort' }) // cost 1
    expect(c.clock).toBe(2)
    c.turn({ op: 'wait' }) // no travel -> no time
    expect(c.clock).toBe(2)
  })

  it('a defeated attacker is removed from the map', () => {
    const c = fixtureCampaign(1)
    c.turn({ op: 'travel', dest: 'town' })
    c.turn({ op: 'travel', dest: 'fort' })
    expect(c.playerParty()).toBeDefined()
    c.turn({ op: 'capture' }) // str 5 vs fort def 99 -> loses -> removed
    expect(c.playerParty()).toBeUndefined()
    expect(c.ownerOf('fort')).toBe('neutral') // ownership unchanged on a failed assault
  })

  it('a weakened victor persists', () => {
    const c = fixtureCampaign(1)
    const before = c.playerParty()!.strength
    c.turn({ op: 'travel', dest: 'town' })
    c.turn({ op: 'capture' }) // win vs def 3
    const after = c.playerParty()
    expect(after).toBeDefined()
    expect(after!.strength).toBeLessThan(before) // took casualties
    expect(after!.strength).toBeGreaterThanOrEqual(1) // but survived
  })
})
