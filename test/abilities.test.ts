import { describe, it, expect } from 'vitest'
import { makeAbilitySystem } from '../src/engine/abilities'
import { makeRng } from '../src/engine/rng'
import type { AbilityDef, EffectContext, GameEvent, LogEntry, Unit } from '../src/engine/types'
import { content, uniformGrid, setTerrain, place, makeState } from './helpers'

function ctxFor(units: Unit[], grid = uniformGrid(5, 5), seed = 1): { ctx: EffectContext; log: LogEntry[] } {
  const state = makeState(grid, units)
  const log: LogEntry[] = []
  const ctx: EffectContext = { state, content, rng: makeRng(seed), log: (e) => log.push(e) }
  return { ctx, log }
}

const evt = (type: GameEvent['type'], unit: Unit, target?: Unit): GameEvent => ({ type, unit, target })

describe('ability system — primitives', () => {
  it('modify_stat applies a passive; maxHp also raises current HP', () => {
    const sys = makeAbilitySystem()
    const u = place('hana', 'h', { x: 1, y: 1 })
    const { ctx } = ctxFor([u])
    sys.applyOnGain(ctx, u, content.abilities.swift_step) // +2 spd
    expect(u.stats.spd).toBe(12)

    const hpBoost: AbilityDef = {
      id: 'toughen', name: 'Toughen', trigger: 'on_gain',
      effects: [{ type: 'modify_stat', stat: 'maxHp', amount: 5 }],
    }
    const hpBefore = u.hp
    sys.applyOnGain(ctx, u, hpBoost)
    expect(u.stats.maxHp).toBe(27)
    expect(u.hp).toBe(hpBefore + 5)
  })

  it('heal restores up to maxHp and no further', () => {
    const sys = makeAbilitySystem()
    const u = place('yuki', 'y', { x: 1, y: 1 })
    u.hp = 25 // maxHp 28
    const { ctx } = ctxFor([u])
    sys.dispatch(ctx, evt('on_gain', u)) // no-op; use direct effect via a temp ability
    const bigHeal: AbilityDef = { id: 'mend', name: 'Mend', trigger: 'on_kill', effects: [{ type: 'heal', amount: 10 }] }
    u.abilities.push(bigHeal)
    sys.dispatch(ctx, evt('on_kill', u))
    expect(u.hp).toBe(28)
  })
})

describe('ability system — evolution', () => {
  it('on_kill grants a new ability and a new name', () => {
    const sys = makeAbilitySystem()
    const u = place('hana', 'h', { x: 1, y: 1 }) // starts with evolve_on_kill only
    const before = u.abilities.length
    const beforeName = u.name
    const { ctx, log } = ctxFor([u])
    sys.dispatch(ctx, evt('on_kill', u))
    expect(u.abilities.length).toBe(before + 1)
    expect(u.name).not.toBe(beforeName)
    expect(u.name.startsWith('Hana ')).toBe(true) // epithet appended to given name
    expect(log.some((e) => e.kind === 'evolve')).toBe(true)
    expect(log.some((e) => e.kind === 'rename')).toBe(true)
  })

  it('a granted passive takes effect immediately (forced pool)', () => {
    const sys = makeAbilitySystem()
    const u = place('hana', 'h', { x: 1, y: 1 }) // atk 9
    const forcedGrant: AbilityDef = {
      id: 'forced', name: 'Forced Growth', trigger: 'on_kill',
      effects: [{ type: 'grant_random_ability', pool: ['keen_arm'] }], // only option -> +2 atk now
    }
    u.abilities = [forcedGrant]
    const { ctx } = ctxFor([u])
    sys.dispatch(ctx, evt('on_kill', u))
    expect(u.stats.atk).toBe(11)
    expect(u.abilities.some((a) => a.id === 'keen_arm')).toBe(true)
  })

  it('grant excludes abilities already held, and reports when tapped out', () => {
    const sys = makeAbilitySystem()
    const u = place('hana', 'h', { x: 1, y: 1 })
    const grantHeld: AbilityDef = {
      id: 'g', name: 'G', trigger: 'on_kill',
      effects: [{ type: 'grant_random_ability', pool: ['keen_arm'] }],
    }
    u.abilities = [grantHeld, content.abilities.keen_arm] // already has the only pool option
    const { ctx, log } = ctxFor([u])
    const atkBefore = u.stats.atk
    sys.dispatch(ctx, evt('on_kill', u))
    expect(u.stats.atk).toBe(atkBefore) // nothing new granted, no re-apply
    expect(log.some((e) => e.message.includes('nothing new'))).toBe(true)
  })

  it('an ability granted during dispatch does not fire for the same event', () => {
    const sys = makeAbilitySystem()
    const u = place('hana', 'h', { x: 1, y: 1 })
    // Grant vengeful_bloom (on_kill heal 6) on this kill; it must NOT heal now.
    u.hp = 10
    const grantHealer: AbilityDef = {
      id: 'g', name: 'G', trigger: 'on_kill',
      effects: [{ type: 'grant_random_ability', pool: ['vengeful_bloom'] }],
    }
    u.abilities = [grantHealer]
    const { ctx } = ctxFor([u])
    sys.dispatch(ctx, evt('on_kill', u))
    expect(u.abilities.some((a) => a.id === 'vengeful_bloom')).toBe(true)
    expect(u.hp).toBe(10) // heal deferred to the NEXT kill
    sys.dispatch(ctx, evt('on_kill', u))
    expect(u.hp).toBe(16) // now it fires
  })
})

describe('ability system — conditions', () => {
  it('on_terrain gates an effect to a terrain type', () => {
    const sys = makeAbilitySystem()
    const grid = uniformGrid(5, 5)
    setTerrain(grid, 1, 1, 'forest')
    const inForest = place('yuki', 'f', { x: 1, y: 1 })
    const onPlain = place('yuki', 'p', { x: 3, y: 3 })
    inForest.hp = 20
    onPlain.hp = 20
    inForest.abilities = [content.abilities.forest_ward]
    onPlain.abilities = [content.abilities.forest_ward]
    const { ctx } = ctxFor([inForest, onPlain], grid)
    sys.dispatch(ctx, evt('on_turn_start', inForest))
    sys.dispatch(ctx, evt('on_turn_start', onPlain))
    expect(inForest.hp).toBe(22) // healed in forest
    expect(onPlain.hp).toBe(20) // condition failed on plain
  })
})
