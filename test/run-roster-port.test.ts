import { describe, it, expect } from 'vitest'
import { makeRunRosterPort } from '../src/run/roster-port'
import { Run, type RosterEntry } from '../src/run/run'
import { instantiateUnit } from '../src/engine/content'
import { runContent } from '../src/run/content'
import { makeInMemoryRosterPort, makeUpkeepLedger, payUpkeep, type EconomyConfig, type Resources } from '../src/campaign/economy'

// The run-layer adapter is the REAL cross-layer binding: a RosterPort backed by a
// live run roster. These tests prove it reads genuine run-layer unit state and
// that removeUnit deletes real roster entries (the levy permadeath that crosses
// the boundary) — NOT an in-memory stand-in. Faction ids are plain strings here
// so the test, like the adapter, never imports the campaign layer.

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

describe('run-layer RosterPort adapter — real binding to live run state', () => {
  it('reads unit identity + tier straight off a live Run roster', () => {
    const run = new Run({ seed: 7 })
    const port = makeRunRosterPort('player', run)

    expect(port.factions()).toEqual(['player'])
    const units = port.units('player')
    expect(units).toEqual(run.roster.map((e) => ({ id: e.unit.id, tier: e.unit.tier })))
    // The default elf roster is all `named` — read from the real Unit objects.
    expect(units.every((u) => u.tier === 'named')).toBe(true)
    // A run represents one faction; any other faction reports an empty roster.
    expect(port.units('raiders')).toEqual([])
  })

  it('removeUnit deletes the entry from the live run roster (permadeath crosses the port)', () => {
    const run = new Run({ seed: 7 })
    const victim = run.roster[0].unit.id
    const before = run.roster.length
    const port = makeRunRosterPort('player', run)

    port.removeUnit('player', victim)

    expect(run.roster.some((e) => e.unit.id === victim)).toBe(false) // gone from REAL run state
    expect(run.roster.length).toBe(before - 1)
    expect(port.removeUnit('player', 'does-not-exist')).toBeUndefined() // no-op, no throw
  })

  it('a starved levy is removed from the live run roster through payUpkeep', () => {
    // Build a run-layer roster holding a real levy unit (skeleton def = levy tier).
    const levy: RosterEntry = { unit: instantiateUnit(runContent, 'skeleton', 'lv#0'), xp: 0, level: 1 }
    const handle = { roster: [levy] }
    const port = makeRunRosterPort('player', handle)
    const bank: Resources = { scrip: 0, stores: 0 } // cannot cover the levy's upkeep

    const failures = payUpkeep(port, makeUpkeepLedger(), 'player', bank, 1, CONFIG)

    expect(failures).toEqual([{ unitId: 'lv#0', tier: 'levy', outcome: 'lost' }])
    expect(handle.roster).toEqual([]) // the real entry is gone
  })

  it('same faction, two ports (run-backed + in-memory) satisfy one interface interchangeably', () => {
    // The economy code cannot tell which implementation it holds — the point of
    // the contract. Both answer factions()/units()/removeUnit() identically in shape.
    const inMem = makeInMemoryRosterPort([{ faction: 'player', units: [{ id: 'a', tier: 'levy' }] }])
    const runBacked = makeRunRosterPort('player', {
      roster: [{ unit: instantiateUnit(runContent, 'skeleton', 'a'), xp: 0, level: 1 }],
    })
    expect(inMem.units('player')).toEqual([{ id: 'a', tier: 'levy' }])
    expect(runBacked.units('player')).toEqual([{ id: 'a', tier: 'levy' }])
  })
})
