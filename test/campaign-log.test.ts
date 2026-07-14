import { describe, it, expect } from 'vitest'
import {
  captureBlockedEvent,
  captureLostEvent,
  captureWonEvent,
  describeCampaignLogEvent,
  miaReturnEvents,
  rivalPolicyEvent,
  upkeepFailureEvents,
  type CampaignLogEvent,
} from '../src/campaign/log'
import type { UpkeepFailure } from '../src/campaign/economy'
import { Campaign } from '../src/campaign/campaign'
import { loadWorld } from '../src/campaign/world'
import type { EconomyConfig } from '../src/campaign/economy'

// This file covers log.ts's pure record-generation (the "real logic" this
// pass adds — everything else, campaign.test.ts / campaign-economy.test.ts /
// the animation pass, is either already covered or presentation-only).

const ctx = { factionName: (f: string) => (f === 'player' ? 'Deepwood Elves' : f === 'blight' ? 'The Blight' : f), nodeName: (n: string) => (n === 'town' ? 'Town' : n) }

describe('log — upkeepFailureEvents', () => {
  it('maps each tier to its own generic, id-less event kind', () => {
    const failures: UpkeepFailure[] = [
      { unitId: 'levy-1', tier: 'levy', outcome: 'lost' },
      { unitId: 'support-1', tier: 'supporting', outcome: 'mia' },
      { unitId: 'named-1', tier: 'named', outcome: 'debt' },
    ]
    const events = upkeepFailureEvents('player', failures)
    expect(events).toEqual([
      { kind: 'upkeep-lost', faction: 'player' },
      { kind: 'upkeep-mia', faction: 'player' },
      { kind: 'upkeep-debt', faction: 'player' },
    ])
    // No unit ids anywhere in the produced records.
    for (const e of events) expect(JSON.stringify(e)).not.toMatch(/levy-1|support-1|named-1/)
  })

  it('no failures this tick => no events', () => {
    expect(upkeepFailureEvents('player', [])).toEqual([])
  })
})

describe('log — miaReturnEvents', () => {
  it('one generic event per returning unit, count preserved, no ids leaked', () => {
    const events = miaReturnEvents('blight', ['u1', 'u2'])
    expect(events).toEqual([
      { kind: 'mia-return', faction: 'blight' },
      { kind: 'mia-return', faction: 'blight' },
    ])
    for (const e of events) expect(JSON.stringify(e)).not.toMatch(/u1|u2/)
  })
})

describe('log — capture events', () => {
  it('won carries the resulting strength; lost/blocked carry only faction+node', () => {
    expect(captureWonEvent('player', 'town', 7)).toEqual({ kind: 'capture', faction: 'player', node: 'town', strength: 7 })
    expect(captureLostEvent('player', 'town')).toEqual({ kind: 'defeat', faction: 'player', node: 'town' })
    expect(captureBlockedEvent('player', 'town')).toEqual({ kind: 'capture-blocked', faction: 'player', node: 'town' })
  })
})

describe('log — rivalPolicyEvent (the spending policy made legible)', () => {
  it('below threshold and not ready: nothing to report', () => {
    expect(rivalPolicyEvent('blight', false, false, false)).toBeNull()
  })

  it('meets threshold but lag has not cleared: holding, reported every such tick', () => {
    expect(rivalPolicyEvent('blight', true, false, false)).toEqual({ kind: 'rival-hold', faction: 'blight' })
  })

  it('lag just cleared this tick (was not ready, now is): expand, reported once on the transition', () => {
    expect(rivalPolicyEvent('blight', true, false, true)).toEqual({ kind: 'rival-expand', faction: 'blight' })
  })

  it('already ready and still ready: no repeat event (not spammy)', () => {
    expect(rivalPolicyEvent('blight', true, true, true)).toBeNull()
  })

  it('acted and reset (was ready, now below threshold): silence — the capture event already covers it', () => {
    expect(rivalPolicyEvent('blight', false, true, false)).toBeNull()
  })
})

describe('log — describeCampaignLogEvent', () => {
  it('renders each kind to a non-empty, faction/node-aware string with no raw ids', () => {
    const cases: CampaignLogEvent[] = [
      { kind: 'capture', faction: 'player', node: 'town', strength: 7 },
      { kind: 'defeat', faction: 'blight', node: 'town' },
      { kind: 'capture-blocked', faction: 'player', node: 'town' },
      { kind: 'upkeep-lost', faction: 'player' },
      { kind: 'upkeep-mia', faction: 'player' },
      { kind: 'upkeep-debt', faction: 'player' },
      { kind: 'mia-return', faction: 'player' },
      { kind: 'rival-hold', faction: 'blight' },
      { kind: 'rival-expand', faction: 'blight' },
    ]
    for (const e of cases) {
      const text = describeCampaignLogEvent(e, ctx)
      expect(text.length).toBeGreaterThan(0)
    }
    expect(describeCampaignLogEvent(cases[0], ctx)).toContain('Town')
    expect(describeCampaignLogEvent(cases[0], ctx)).toContain('Deepwood Elves')
    expect(describeCampaignLogEvent(cases[0], ctx)).toContain('7')
  })
})

// --- integration: campaign.ts actually routes tick outcomes through log.ts --

const CONFIG: EconomyConfig = {
  startingScrip: 20,
  startingStores: 20,
  nodeYield: { scrip: 10, stores: 10 },
  yieldVariance: 0,
  captureCost: 15,
  upkeepCost: { levy: 2, supporting: 3, named: 5 },
  debtInterestRate: 0.1,
  debtConversionRate: 1,
  miaReturnTicks: 3,
  rivalPolicy: { expandThreshold: 30, reactionLagTicks: 2 },
}

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
  ],
  edges: [
    { a: 'home', b: 'town', cost: 1 },
    { a: 'town', b: 'fort', cost: 1 },
    { a: 'town', b: 'keep', cost: 5 },
  ],
  parties: [
    {
      id: 'player', faction: 'player', start: 'home', strength: 5,
      roster: [{ id: 'p-levy', tier: 'levy' }],
    },
    { id: 'raider', faction: 'raiders', start: 'keep', strength: 5, roster: [{ id: 'r-levy', tier: 'levy' }] },
  ],
}
const fixtureCampaign = (seed: number, economy: EconomyConfig = CONFIG) => new Campaign(loadWorld(FIXTURE), seed, { economy })

describe('integration — Campaign routes real tick outcomes through log.ts', () => {
  // The rival can also log its own events on the same tick, so filter to the
  // player's side rather than trusting "the last event overall".
  const lastPlayerEvent = (c: Campaign) => c.events.filter((e) => e.event.faction === 'player').at(-1)!.event

  it('a won capture logs a capture event for the right faction/node', () => {
    const c = fixtureCampaign(1)
    c.turn({ op: 'travel', dest: 'town' })
    c.turn({ op: 'capture' }) // town def 3 < strength 5 -> wins
    expect(lastPlayerEvent(c)).toMatchObject({ kind: 'capture', faction: 'player', node: 'town' })
  })

  it('a lost capture logs a defeat event', () => {
    const c = fixtureCampaign(1)
    c.turn({ op: 'travel', dest: 'town' })
    c.turn({ op: 'travel', dest: 'fort' })
    c.turn({ op: 'capture' }) // fort def 99 > strength 5 -> loses
    expect(lastPlayerEvent(c)).toEqual({ kind: 'defeat', faction: 'player', node: 'fort' })
  })

  it('an unaffordable capture logs capture-blocked, not a battle event', () => {
    const poor: EconomyConfig = { ...CONFIG, startingScrip: 0, nodeYield: { scrip: 0, stores: 0 } }
    const c = fixtureCampaign(1, poor)
    c.turn({ op: 'travel', dest: 'town' })
    c.turn({ op: 'capture' })
    expect(lastPlayerEvent(c)).toEqual({ kind: 'capture-blocked', faction: 'player', node: 'town' })
  })

  it('an upkeep shortfall logs the tier-correct event, generic (no ids)', () => {
    const starved: EconomyConfig = { ...CONFIG, startingStores: 0, nodeYield: { scrip: 0, stores: 0 } }
    const c = fixtureCampaign(1, starved)
    c.turn({ op: 'wait' }) // player's one levy can't be fed
    const kinds = c.events.map((e) => e.event.kind)
    expect(kinds).toContain('upkeep-lost')
    for (const e of c.events) expect(JSON.stringify(e.event)).not.toMatch(/p-levy/)
  })

  it('rival policy: holds (logged) while surplus builds, expands (logged once) when the lag clears — no repeat spam', () => {
    // Exactly one expansion cycle: tick1 builds surplus (hold), tick2 clears
    // the lag (expand — this is a movement tick, town is one hop from keep),
    // tick3 arrives and captures. Beyond this window a SECOND cycle can
    // start (more territory -> more income -> surplus again), so this test
    // only asserts within the first cycle, not "ever exactly one".
    const c = fixtureCampaign(11)
    for (let i = 0; i < 3; i++) c.turn({ op: 'wait' })
    const rivalKinds = c.events.filter((e) => e.event.faction === 'raiders').map((e) => e.event.kind)
    expect(rivalKinds.filter((k) => k === 'rival-hold').length).toBe(1)
    expect(rivalKinds.filter((k) => k === 'rival-expand').length).toBe(1) // one transition, not one per ready tick
    expect(rivalKinds).toContain('capture')
    expect(rivalKinds.indexOf('rival-hold')).toBeLessThan(rivalKinds.indexOf('rival-expand'))
  })
})
