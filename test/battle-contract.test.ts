import { describe, it, expect } from 'vitest'
import { Campaign, fallenNamed } from '../src/campaign/campaign'
import { autoResolve } from '../src/campaign/resolve'
import { loadWorld } from '../src/campaign/world'
import { makeBattleResolveBattle } from '../src/run/battle-resolver'
import { makeInMemoryRosterPort } from '../src/campaign/economy'
import { runContent } from '../src/run/content'
import { instantiateUnit } from '../src/engine/content'
import { describeCampaignLogEvent } from '../src/campaign/log'
import type { BattleRequest, ResolveBattle } from '../src/contracts/battle'
import type { RosterUnitRef } from '../src/contracts/roster'

// The campaign<->battle CONTRACT: one BattleRequest/BattleResult shape, satisfied
// by BOTH the aggregate auto-resolver and the real hand-fight resolver. The
// campaign calls the socket and applies the aggregate result identically, never
// learning which resolver answered. Named-unit facts reach the campaign ONLY by
// diffing the roster through the port — never on the result.

// A minimal world: player sits on owned Home, one step from a weak neutral Town.
const WORLD = {
  factions: [
    { id: 'player', name: 'Elves', color: '#0f0' },
    { id: 'neutral', name: 'Free', color: '#888' },
  ],
  nodes: [
    { id: 'home', name: 'Home', kind: 'settlement', owner: 'player', defense: 5, x: 0, y: 0 },
    { id: 'town', name: 'Town', kind: 'settlement', owner: 'neutral', defense: 3, x: 1, y: 0 },
  ],
  edges: [{ a: 'home', b: 'town', cost: 1 }],
  parties: [{ id: 'player', faction: 'player', start: 'home', strength: 8 }],
}

// A hand-fight resolver that fields four strong named elves — enough to sweep the
// placeholder garrison. Fresh units each call so replays are byte-identical.
const ELVES = ['sakura', 'hana', 'yuki', 'aoi']
const handResolver = (): ResolveBattle =>
  makeBattleResolveBattle({
    content: runContent,
    fieldAttacker: (faction) =>
      faction === 'player' ? ELVES.map((d, i) => instantiateUnit(runContent, d, `${d}#${i}`)) : [],
  })

// Script: travel home->town, capture, then idle. The capture is the one battle.
const play = (seed: number, resolveBattle: ResolveBattle) => {
  const c = new Campaign(loadWorld(WORLD), seed, { resolveBattle })
  c.turn({ op: 'travel', dest: 'town' })
  c.turn({ op: 'capture' })
  c.turn({ op: 'wait' })
  return c
}

describe('battle contract — both resolvers satisfy one socket', () => {
  it('a request round-trips through the AUTO path to a valid aggregate result', () => {
    const req: BattleRequest = {
      attacker: { faction: 'player', strength: 8 },
      defender: { faction: 'neutral', strength: 3 },
      terrainSeed: 123,
      seed: 42,
    }
    const r = autoResolve(req)
    expect(r.winner).toBe('attacker') // 8 > 3
    expect(r.attackerDelta).toBeLessThanOrEqual(0)
    expect(8 + r.attackerDelta).toBeGreaterThanOrEqual(1) // victor survives
    expect(r.defenderDelta).toBe(-3) // loser spent
    // Strictly aggregate: no unit-level fields on the result.
    expect(Object.keys(r).sort()).toEqual(['attackerDelta', 'defenderDelta', 'winner'])
  })

  it('a request round-trips through the HAND path to a valid aggregate result', () => {
    const req: BattleRequest = {
      attacker: { faction: 'player', strength: 8 },
      defender: { faction: 'neutral', strength: 3 },
      terrainSeed: 123,
      seed: 42,
    }
    const r = handResolver()(req)
    expect(r.winner).toBe('attacker') // four elves sweep three skeletons
    expect(8 + r.attackerDelta).toBeGreaterThanOrEqual(1)
    expect(Object.keys(r).sort()).toEqual(['attackerDelta', 'defenderDelta', 'winner'])
  })

  it('the campaign applies the result identically regardless of which resolver answered', () => {
    // Both paths win the town; the campaign flips ownership and weakens the party
    // the same way — its apply logic never branches on the resolver.
    const auto = play(7, autoResolve)
    const hand = play(7, handResolver())
    expect(auto.ownerOf('town')).toBe('player')
    expect(hand.ownerOf('town')).toBe('player')
    const ap = auto.playerParty()!
    const hp = hand.playerParty()!
    expect(ap.strength).toBeGreaterThanOrEqual(1) // survived, weakened
    expect(hp.strength).toBeGreaterThanOrEqual(1)
  })
})

describe('battle contract — determinism across both paths', () => {
  it('AUTO: same seed + choices -> byte-identical campaign', () => {
    expect(play(31, autoResolve).snapshot()).toEqual(play(31, autoResolve).snapshot())
  })

  it('HAND: same seed + choices -> byte-identical campaign', () => {
    // Fresh resolver + fresh units each run; autoPlay is deterministic, so the two
    // replays produce identical snapshots.
    expect(play(31, handResolver()).snapshot()).toEqual(play(31, handResolver()).snapshot())
  })
})

describe('named-casualty diff — the port channel', () => {
  it('fallenNamed reports a named unit that went in and did not return, by name', () => {
    const before: RosterUnitRef[] = [
      { id: 'n1', tier: 'named', name: 'Kaede' },
      { id: 'n2', tier: 'named', name: 'Mei' },
      { id: 'l1', tier: 'levy', name: 'l1' },
    ]
    const after: RosterUnitRef[] = [
      { id: 'n1', tier: 'named', name: 'Kaede' },
      { id: 'l1', tier: 'levy', name: 'l1' },
    ]
    expect(fallenNamed(before, after)).toEqual(['Mei'])
  })

  it('a fallen LEVY is not mourned by name (only named units cross this channel)', () => {
    const before: RosterUnitRef[] = [{ id: 'l1', tier: 'levy', name: 'l1' }]
    expect(fallenNamed(before, [])).toEqual([]) // levies fall generically, via upkeep
  })

  it('the campaign learns the name by reading the port back, not from the result', () => {
    // Simulate a resolver that applied a run-side casualty: snapshot, remove, diff.
    const port = makeInMemoryRosterPort([
      { faction: 'player', units: [{ id: 'n1', tier: 'named', name: 'Naomi' }] },
    ])
    const snapshot = port.units('player').map((u) => ({ ...u }))
    port.removeUnit('player', 'n1') // the run layer's consequence of the battle
    const fallen = fallenNamed(snapshot, port.units('player'))
    expect(fallen).toEqual(['Naomi'])
    // And it renders as a mourning line naming the unit.
    const line = describeCampaignLogEvent(
      { kind: 'battle-casualty', faction: 'player', name: fallen[0] },
      { factionName: () => 'the Elves', nodeName: (n) => n },
    )
    expect(line).toContain('Naomi')
  })
})

describe('boundary — the port read stays narrow', () => {
  it('port units expose only id, tier, name (no run/engine internals leak)', () => {
    const port = makeInMemoryRosterPort([
      { faction: 'player', units: [{ id: 'u', tier: 'named', name: 'Yuki' }] },
    ])
    for (const u of port.units('player')) {
      expect(Object.keys(u).sort()).toEqual(['id', 'name', 'tier'])
    }
  })
})
