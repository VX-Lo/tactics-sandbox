import { describe, it, expect } from 'vitest'
import {
  resolveCombat,
  forecast,
  hitChance,
  baseDamage,
  critChance,
  doubles,
  inAttackRange,
  ELEVATION_CRIT_PER_LEVEL,
} from '../src/engine/combat'
import { content, uniformGrid, setElevation, place, makeState } from './helpers'

// Scripted rollers make combat deterministic without leaning on the real RNG's
// exact stream, so tests state intent ("all hits, no crits") directly.
const hitNoCrit = { chance: (p: number) => p >= 0.5 } // hit% high => true, crit% low => false
const allCrit = { chance: () => true }
const allMiss = { chance: (p: number) => p >= 1 }

describe('combat sub-calculations', () => {
  it('baseDamage is atk minus def+terrain, floored at 1', () => {
    const hana = place('hana', 'h', { x: 0, y: 0 }) // atk 9
    const yuki = place('yuki', 'y', { x: 0, y: 0 }) // def 7
    expect(baseDamage(hana, yuki, 0)).toBe(2)
    expect(baseDamage(hana, yuki, 5)).toBe(1) // def+terrain would zero it -> floor
  })

  it('hitChance folds in skill and subtracts terrain avoid, clamped to 99', () => {
    const hana = place('hana', 'h', { x: 0, y: 0 }) // hit 92, skl 10 => 102 -> clamp 99
    expect(hitChance(hana, 0)).toBe(99)
    expect(hitChance(hana, 20)).toBe(82) // forest avoid
  })

  it('critChance rises with height advantage only', () => {
    const grid = uniformGrid(5, 5)
    const hi = place('hana', 'h', { x: 1, y: 1 }) // base crit 12
    const lo = place('skeleton', 's', { x: 2, y: 1 })
    setElevation(grid, 1, 1, 2)
    setElevation(grid, 2, 1, 0)
    const state = makeState(grid, [hi, lo])
    expect(critChance(state, hi, lo)).toBe(12 + 2 * ELEVATION_CRIT_PER_LEVEL)
    // Attacking uphill gives no bonus.
    expect(critChance(state, lo, hi)).toBe(2)
  })

  it('doubles requires a speed lead of the threshold', () => {
    const hana = place('hana', 'h', { x: 0, y: 0 }) // spd 10
    const skel = place('skeleton', 's', { x: 0, y: 0 }) // spd 5
    expect(doubles(hana, skel)).toBe(true)
    expect(doubles(skel, hana)).toBe(false)
  })

  it('inAttackRange respects min/max range', () => {
    const sakura = place('sakura', 'sk', { x: 0, y: 0 }) // range 2-2
    const near = place('skeleton', 'n', { x: 1, y: 0 })
    const far = place('skeleton', 'f', { x: 2, y: 0 })
    expect(inAttackRange(sakura, near)).toBe(false) // too close for a 2-range bow
    expect(inAttackRange(sakura, far)).toBe(true)
  })
})

describe('resolveCombat sequencing', () => {
  it('attacker strikes, defender counters, faster attacker doubles', () => {
    const grid = uniformGrid(5, 5)
    const hana = place('hana', 'h', { x: 1, y: 1 }) // atk9 spd10
    const skel = place('skeleton', 's', { x: 2, y: 1 }) // def3 spd5
    skel.hp = 20 // pin HP so the full exchange (attack, counter, double) plays out without a death
    const state = makeState(grid, [hana, skel])
    const r = resolveCombat(state, content, hitNoCrit, hana, skel)
    // attack (6) -> counter (skel atk7-def4=3) -> double (6)
    expect(r.blows.map((b) => b.strikerId)).toEqual(['h', 's', 'h'])
    expect(skel.hp).toBe(20 - 12)
    expect(hana.hp).toBe(22 - 3)
    expect(r.deaths).toEqual([])
  })

  it('a ranged attacker out of counter-range is not countered but still doubles', () => {
    const grid = uniformGrid(6, 5)
    const sakura = place('sakura', 'sk', { x: 1, y: 1 }) // range2 spd9
    const skel = place('skeleton', 's', { x: 3, y: 1 }) // distance 2, melee
    skel.hp = 20 // pin HP so the doubled hits both land without a death ending the exchange
    const state = makeState(grid, [sakura, skel])
    const r = resolveCombat(state, content, hitNoCrit, sakura, skel)
    expect(r.blows.map((b) => b.strikerId)).toEqual(['sk', 'sk']) // no counter, but doubled
    expect(skel.hp).toBe(20 - 2 * (8 - 3))
  })

  it('a kill ends the exchange: no counter, no follow-up', () => {
    const grid = uniformGrid(5, 5)
    const hana = place('hana', 'h', { x: 1, y: 1 })
    const skel = place('skeleton', 's', { x: 2, y: 1 })
    skel.hp = 5 // one blow (6) kills
    const state = makeState(grid, [hana, skel])
    const r = resolveCombat(state, content, hitNoCrit, hana, skel)
    expect(r.blows).toHaveLength(1)
    expect(r.blows[0].killed).toBe(true)
    expect(r.deaths).toEqual([{ killerId: 'h', victimId: 's' }])
    expect(skel.alive).toBe(false)
    expect(hana.kills).toBe(1)
    expect(hana.hp).toBe(22) // never took a counter
  })

  it('misses deal no damage', () => {
    const grid = uniformGrid(5, 5)
    const hana = place('hana', 'h', { x: 1, y: 1 })
    const skel = place('skeleton', 's', { x: 2, y: 1 })
    skel.hp = 20 // pin HP; the assertion is that a full miss leaves it untouched
    const state = makeState(grid, [hana, skel])
    const r = resolveCombat(state, content, allMiss, hana, skel)
    expect(r.blows.every((b) => !b.hit && b.damage === 0)).toBe(true)
    expect(skel.hp).toBe(20)
  })

  it('crits multiply damage by 1.5 (rounded)', () => {
    const grid = uniformGrid(5, 5)
    const hana = place('hana', 'h', { x: 1, y: 1 }) // base dmg vs skel = 6
    const skel = place('skeleton', 's', { x: 2, y: 1 })
    const state = makeState(grid, [hana, skel])
    const r = resolveCombat(state, content, allCrit, hana, skel)
    expect(r.blows[0].crit).toBe(true)
    expect(r.blows[0].damage).toBe(Math.round(6 * 1.5)) // 9
  })
})

describe('forecast', () => {
  it('previews both sides, null defender when it cannot counter', () => {
    const grid = uniformGrid(6, 5)
    const sakura = place('sakura', 'sk', { x: 1, y: 1 })
    const skel = place('skeleton', 's', { x: 3, y: 1 })
    const state = makeState(grid, [sakura, skel])
    const f = forecast(state, content, sakura, skel)
    expect(f.attacker.damage).toBe(5)
    expect(f.defender).toBeNull() // melee skeleton can't reach a range-2 attacker
  })
})
