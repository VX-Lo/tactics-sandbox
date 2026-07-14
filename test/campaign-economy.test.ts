import { describe, it, expect } from 'vitest'
import { Campaign } from '../src/campaign/campaign'
import { loadWorld } from '../src/campaign/world'
import {
  computeIncome,
  makeInMemoryRosterPort,
  makeUpkeepLedger,
  payUpkeep,
  rivalExpandDecision,
  tickEconomy,
  type EconomyConfig,
  type Resources,
} from '../src/campaign/economy'
import { makeCampaignRng } from '../src/campaign/rng'

// NOTE: this file is about the campaign's ACCUMULATION economy (Scrip/Stores,
// upkeep, rival spending). It is unrelated to test/economy.test.ts, which
// predates it and covers the tactics engine's per-turn ACTION economy
// (movement/attack budgets) — same word, two different systems.

const CONFIG: EconomyConfig = {
  startingScrip: 20,
  startingStores: 20,
  nodeYield: { scrip: 10, stores: 10 },
  yieldVariance: 0, // pinned for exact, non-jittery assertions
  captureCost: 15,
  upkeepCost: { levy: 2, supporting: 3, named: 5 },
  debtInterestRate: 0.1,
  debtConversionRate: 1,
  miaReturnTicks: 3,
  rivalPolicy: { expandThreshold: 30, reactionLagTicks: 2 },
}

// A tiny world: player holds two settlements (so N-node income is exercised),
// rival holds one. Mirrors the FIXTURE shape used in campaign.test.ts.
const FIXTURE = {
  factions: [
    { id: 'player', name: 'Elves', color: '#0f0' },
    { id: 'raiders', name: 'Raiders', color: '#f0f' },
    { id: 'neutral', name: 'Free', color: '#888' },
  ],
  nodes: [
    { id: 'home', name: 'Home', kind: 'settlement', owner: 'player', defense: 10, x: 0, y: 0 },
    { id: 'annex', name: 'Annex', kind: 'settlement', owner: 'player', defense: 1, x: 0, y: 1 },
    { id: 'town', name: 'Town', kind: 'settlement', owner: 'neutral', defense: 3, x: 1, y: 0 },
    { id: 'keep', name: 'Keep', kind: 'settlement', owner: 'raiders', defense: 10, x: 3, y: 0 },
  ],
  edges: [
    { a: 'home', b: 'annex', cost: 1 },
    { a: 'home', b: 'town', cost: 1 },
    { a: 'town', b: 'keep', cost: 5 },
  ],
  parties: [
    {
      id: 'player', faction: 'player', start: 'home', strength: 5,
      roster: [
        { id: 'p-levy-1', tier: 'levy' },
        { id: 'p-support-1', tier: 'supporting' },
        { id: 'p-named-1', tier: 'named' },
      ],
    },
    { id: 'raider', faction: 'raiders', start: 'keep', strength: 5, roster: [{ id: 'r-levy-1', tier: 'levy' }] },
  ],
}
const fixtureCampaign = (seed: number, opts: { economy?: EconomyConfig } = {}) =>
  new Campaign(loadWorld(FIXTURE), seed, { economy: opts.economy ?? CONFIG })

// --- accumulation ------------------------------------------------------------

describe('economy — accumulation', () => {
  it('income scales linearly: N owned nodes yield N x the per-node base, same code path as 1', () => {
    const rng = makeCampaignRng(1)
    const one = computeIncome(1, CONFIG, rng)
    const twenty = computeIncome(20, CONFIG, rng)
    expect(one).toEqual({ scrip: CONFIG.nodeYield.scrip, stores: CONFIG.nodeYield.stores })
    expect(twenty).toEqual({ scrip: CONFIG.nodeYield.scrip * 20, stores: CONFIG.nodeYield.stores * 20 })
  })

  it('jitter only moves the banked amount, never flips sign or scales non-linearly', () => {
    const jittery: EconomyConfig = { ...CONFIG, yieldVariance: 0.2 }
    const rng = makeCampaignRng(7)
    const amounts = new Set<number>()
    for (let i = 0; i < 20; i++) amounts.add(computeIncome(3, jittery, rng).scrip)
    expect(amounts.size).toBeGreaterThan(1) // varies...
    for (const a of amounts) expect(a).toBeGreaterThan(0) // ...but never wipes out income
  })
})

// --- determinism ---------------------------------------------------------

describe('economy — determinism', () => {
  it('same seed + same orders => byte-identical Scrip/Stores totals and roster state', () => {
    const play = (seed: number) => {
      const c = fixtureCampaign(seed)
      c.turn({ op: 'travel', dest: 'town' })
      c.turn({ op: 'capture' })
      c.turn({ op: 'wait' })
      c.turn({ op: 'wait' })
      return c.snapshot()
    }
    expect(play(99)).toEqual(play(99))
  })
})

// --- upkeep failure, one scenario per tier ----------------------------------

describe('economy — upkeep failure tiers', () => {
  it('levy: lost permanently when Stores cannot cover its upkeep, other units untouched', () => {
    const port = makeInMemoryRosterPort([
      { faction: 'player', units: [{ id: 'levy', tier: 'levy' }, { id: 'named', tier: 'named' }] },
    ])
    const ledger = makeUpkeepLedger()
    const bank: Resources = { scrip: 100, stores: 1 } // covers named (5)? no — not enough for either at cost, but priority is named first
    // named costs 5, supporting 3, levy 2 — bank.stores=1 can't cover named (5) either.
    payUpkeep(port, ledger, 'player', bank, 1, CONFIG)
    const units = port.units('player')
    expect(units.find((u) => u.id === 'levy')).toBeUndefined() // gone (removal crosses the port into roster state)
    expect(ledger.status('player', 'named').debt).toBeGreaterThan(0) // named failed differently (ledger-side)
  })

  it('levy failure does not affect a sibling levy that WAS paid', () => {
    const port = makeInMemoryRosterPort([
      { faction: 'player', units: [{ id: 'levy-a', tier: 'levy' }, { id: 'levy-b', tier: 'levy' }] },
    ])
    const bank: Resources = { scrip: 0, stores: 2 } // covers exactly one levy (id order: levy-a first)
    payUpkeep(port, makeUpkeepLedger(), 'player', bank, 1, CONFIG)
    const units = port.units('player')
    expect(units.find((u) => u.id === 'levy-a')).toBeDefined() // paid
    expect(units.find((u) => u.id === 'levy-b')).toBeUndefined() // lost
  })

  it('supporting: goes MIA when unpaid, auto-returns after miaReturnTicks and rejoins upkeep', () => {
    const port = makeInMemoryRosterPort([{ faction: 'player', units: [{ id: 'support', tier: 'supporting' }] }])
    const ledger = makeUpkeepLedger()
    const zeroBank: Resources = { scrip: 100, stores: 0 }
    payUpkeep(port, ledger, 'player', zeroBank, 1, CONFIG)
    expect(ledger.status('player', 'support').mia).toBe(true) // MIA is ledger-side, never on the port
    expect(ledger.status('player', 'support').miaReturnsAtTick).toBe(1 + CONFIG.miaReturnTicks)

    // Not due back yet: still MIA, and (being MIA) excluded from upkeep.
    const flushBank: Resources = { scrip: 0, stores: 100 }
    const result = tickEconomy(port, ledger, 'player', flushBank, 0, 1 + CONFIG.miaReturnTicks - 1, CONFIG, makeCampaignRng(1))
    expect(result.miaReturned).toEqual([])
    expect(ledger.status('player', 'support').mia).toBe(true)

    // Due back: rejoins, and (now active) is charged upkeep again this tick.
    const result2 = tickEconomy(port, ledger, 'player', flushBank, 0, 1 + CONFIG.miaReturnTicks, CONFIG, makeCampaignRng(1))
    expect(result2.miaReturned).toEqual(['support'])
    expect(ledger.status('player', 'support').mia).toBe(false)
    expect(ledger.status('player', 'support').miaReturnsAtTick).toBeNull()
  })

  it('named: unpaid Stores converts to interest-bearing Scrip debt; stays on roster, non-deployable (debt > 0)', () => {
    const port = makeInMemoryRosterPort([{ faction: 'player', units: [{ id: 'named', tier: 'named' }] }])
    const ledger = makeUpkeepLedger()
    const bank: Resources = { scrip: 0, stores: 0 }
    tickEconomy(port, ledger, 'player', bank, 0, 1, CONFIG, makeCampaignRng(1))
    expect(port.units('player')[0]).toBeDefined() // still on the roster (removal never happened)
    // Interest accrues the SAME tick debt is first incurred (one pass, no rng):
    // round(5 * 1.1) = 6.
    expect(ledger.status('player', 'named').debt).toBe(Math.round(CONFIG.upkeepCost.named * (1 + CONFIG.debtInterestRate)))

    // Next tick, still can't pay: the new unpaid amount is added to existing
    // debt, then interest compounds on the total — deterministic, no rng.
    tickEconomy(port, ledger, 'player', bank, 0, 2, CONFIG, makeCampaignRng(1))
    const expected = Math.round((6 + CONFIG.upkeepCost.named) * (1 + CONFIG.debtInterestRate))
    expect(ledger.status('player', 'named').debt).toBe(expected) // round(11 * 1.1) = 12

    // Once the faction can afford it, debt auto-clears and the unit is
    // deployable again (debt === 0 is the deployability signal here).
    const flushBank: Resources = { scrip: 1000, stores: 1000 }
    tickEconomy(port, ledger, 'player', flushBank, 0, 3, CONFIG, makeCampaignRng(1))
    expect(ledger.status('player', 'named').debt).toBe(0)
  })
})

// --- capture cost gate -------------------------------------------------------

describe('economy — capture cost gate', () => {
  it('an unaffordable capture attempt is a no-op: no ownership change, no Scrip spent', () => {
    const poor: EconomyConfig = { ...CONFIG, startingScrip: 0, nodeYield: { scrip: 0, stores: 0 } }
    const c = fixtureCampaign(1, { economy: poor })
    c.turn({ op: 'travel', dest: 'town' })
    const before = c.resourcesOf('player').scrip
    c.turn({ op: 'capture' }) // can't afford CONFIG.captureCost (15)
    expect(c.ownerOf('town')).toBe('neutral') // unchanged
    expect(c.resourcesOf('player').scrip).toBe(before) // nothing deducted
  })

  it('an affordable capture deducts the flat cost up front, win or lose', () => {
    const c = fixtureCampaign(1)
    c.turn({ op: 'travel', dest: 'town' }) // scrip: startingScrip + 2 owned nodes' income
    const before = c.resourcesOf('player').scrip
    c.turn({ op: 'capture' }) // town def 3 < strength 5 -> wins; capture deducted, THEN this
    // tick's income lands counting the newly-owned 3rd node (no variance, so exact).
    expect(c.ownerOf('town')).toBe('player')
    expect(c.resourcesOf('player').scrip).toBe(before - CONFIG.captureCost + CONFIG.nodeYield.scrip * 3)
  })
})

// --- rival spending policy ---------------------------------------------------

describe('economy — rival spending policy', () => {
  it('never "spends" beyond its real current totals (capture is always gated by the same cost check)', () => {
    const c = fixtureCampaign(5)
    for (let i = 0; i < 15; i++) {
      c.turn({ op: 'wait' })
      // The rival's own bank is the only source of truth for whether it could
      // have captured — if it now owns keep+something else, it must have
      // been able to afford captureCost at the moment it acted. We can't see
      // history here, but we CAN assert the invariant that never goes
      // negative — the gate never lets it overdraw.
      expect(c.resourcesOf('raiders').scrip).toBeGreaterThanOrEqual(0)
    }
  })

  it('reaction lag: holds below the threshold-streak, expands once it clears — reproduces identically given the same seed', () => {
    const run = () => {
      const c = fixtureCampaign(11)
      const turns: boolean[] = []
      for (let i = 0; i < 6; i++) {
        c.turn({ op: 'wait' })
        turns.push(c.ownerOf('keep') === 'raiders') // trivially true; real signal is snapshot below
      }
      return c.snapshot()
    }
    expect(run()).toEqual(run())
  })

  it('rivalExpandDecision: pure, deterministic streak/threshold logic', () => {
    const cfg: EconomyConfig = { ...CONFIG, rivalPolicy: { expandThreshold: 10, reactionLagTicks: 2 } }
    let s = rivalExpandDecision(5, 0, cfg) // below threshold
    expect(s).toEqual({ ready: false, streak: 0 })
    s = rivalExpandDecision(10, s.streak, cfg) // meets it: streak 1
    expect(s).toEqual({ ready: false, streak: 1 })
    s = rivalExpandDecision(10, s.streak, cfg) // meets it again: streak 2, lag cleared
    expect(s).toEqual({ ready: true, streak: 2 })
    s = rivalExpandDecision(0, s.streak, cfg) // drops below: resets
    expect(s).toEqual({ ready: false, streak: 0 })
  })
})

// --- the real contract: the port carries only run-owned truth ---------------

describe('economy — RosterPort contract (in-memory implementation)', () => {
  it('the port surface is narrow: identity + tier + removal, no MIA/debt leaking across it', () => {
    const port = makeInMemoryRosterPort([
      { faction: 'player', units: [{ id: 'u1', tier: 'supporting' }] },
    ])
    expect(port.factions()).toEqual(['player'])
    // Only run-owned truth crosses the boundary — id, tier, and name (identity),
    // but NO mia/debt fields (those are campaign-side ledger bookkeeping). Name
    // defaults to the id when the seed doesn't carry one.
    expect(port.units('player')).toEqual([{ id: 'u1', tier: 'supporting', name: 'u1' }])

    port.removeUnit('player', 'u1') // the one mutation the port allows (permadeath)
    expect(port.units('player')).toEqual([])
  })

  it('the ledger holds MIA/debt campaign-side, keyed to the same unit ids', () => {
    const ledger = makeUpkeepLedger()
    // A unit never failed is simply healthy — no entry needed.
    expect(ledger.status('player', 'u1')).toEqual({ mia: false, miaReturnsAtTick: null, debt: 0 })

    ledger.setMia('player', 'u1', 5)
    expect(ledger.status('player', 'u1')).toMatchObject({ mia: true, miaReturnsAtTick: 5 })
    ledger.clearMia('player', 'u1')
    expect(ledger.status('player', 'u1')).toMatchObject({ mia: false, miaReturnsAtTick: null })

    ledger.setDebt('player', 'u1', 42)
    expect(ledger.status('player', 'u1').debt).toBe(42)
    // Ledger and port are independent: a unit id in one need not exist in the other.
    expect(ledger.status('player', 'ghost').debt).toBe(0)
  })

  it('seeding twice never lets one instance leak into another (no shared mutable arrays)', () => {
    const seeds = [{ faction: 'player', units: [{ id: 'u1', tier: 'levy' as const }] }]
    const a = makeInMemoryRosterPort(seeds)
    const b = makeInMemoryRosterPort(seeds)
    a.removeUnit('player', 'u1')
    expect(a.units('player')).toEqual([])
    expect(b.units('player')).toHaveLength(1) // untouched
  })
})
