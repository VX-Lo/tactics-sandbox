// The ability system: the engine's proof that "units are data". It never knows
// what "Vengeful Bloom" or "Ironbark" are. It knows only how to, given an
// event, find the abilities on the relevant unit whose trigger matches, check
// their condition, and run their effects — where effects and conditions are
// looked up by string `type` in a registry of primitive handlers.
//
// Consequences of this shape:
//  - Authoring an ability is pure data (a trigger + effects). No engine branch.
//  - The set of PRIMITIVES (modify_stat, heal, grant_random_ability, ...) and
//    the set of TRIGGERS are the engine's fixed, bounded vocabulary. Extending
//    THOSE is a deliberate engine change; recombining them is not.
//  - Registries are returned mutable so content/mods can register new
//    primitives without editing this file.
//
// The on-kill evolution is itself just data (evolve_on_kill in abilities.json):
// the mechanic the brief asked for is expressed in the same grammar as
// everything else, not special-cased here.

import { manhattan, tileAt } from './grid'
import type {
  AbilityDef,
  ConditionHandler,
  EffectContext,
  EffectHandler,
  GameEvent,
  Stats,
  Unit,
} from './types'

export interface AbilitySystem {
  /** Run every ability on event.unit whose trigger matches this event. */
  dispatch(ctx: EffectContext, event: GameEvent): void
  /** Apply a single ability's on_gain effects to a unit that just learned it. */
  applyOnGain(ctx: EffectContext, unit: Unit, ability: AbilityDef): void
  /** Registries, exposed so mods/tests can add primitives. */
  effects: Record<string, EffectHandler>
  conditions: Record<string, ConditionHandler>
}

const NUMERIC_STATS: ReadonlySet<keyof Stats> = new Set<keyof Stats>([
  'maxHp',
  'atk',
  'def',
  'spd',
  'skl',
])

export function makeAbilitySystem(): AbilitySystem {
  const conditions: Record<string, ConditionHandler> = {
    // "Is the ability's owner standing on terrain X?"
    on_terrain: (ctx, cond, event) => {
      const tile = tileAt(ctx.state.grid, event.unit.pos.x, event.unit.pos.y)
      return !!tile && tile.terrain === cond.terrain
    },
  }

  const effects: Record<string, EffectHandler> = {
    // Permanent stat change to the ability's owner. Growing maxHp also grows
    // current HP so a durability boost is felt immediately, not on next heal.
    modify_stat: (ctx, effect, event) => {
      const stat = effect.stat as keyof Stats
      const amount = effect.amount as number
      if (!NUMERIC_STATS.has(stat)) throw new Error(`modify_stat: bad stat "${String(stat)}"`)
      event.unit.stats[stat] += amount
      if (stat === 'maxHp' && amount > 0) event.unit.hp += amount
      ctx.log({
        kind: 'buff',
        message: `${event.unit.name}: ${stat} ${amount >= 0 ? '+' : ''}${amount}.`,
        data: { unitId: event.unit.id, stat, amount },
      })
    },

    heal: (ctx, effect, event) => {
      const amount = effect.amount as number
      const before = event.unit.hp
      event.unit.hp = Math.min(event.unit.stats.maxHp, event.unit.hp + amount)
      const gained = event.unit.hp - before
      if (gained > 0)
        ctx.log({
          kind: 'heal',
          message: `${event.unit.name} recovers ${gained} HP.`,
          data: { unitId: event.unit.id, gained },
        })
    },

    // Heal allied units within `radius` tiles of the owner (excluding the
    // owner). A support primitive: the healer tops up neighbours each turn
    // without any new battle action — it reads state and mends, staying inside
    // the trigger->effect grammar. Deterministic (units iterated in order, no rng).
    heal_allies: (ctx, effect, event) => {
      const healer = event.unit
      const amount = effect.amount as number
      const radius = (effect.radius as number) ?? 1
      for (const u of ctx.state.units) {
        if (!u.alive || u.id === healer.id || u.faction !== healer.faction) continue
        if (manhattan(u.pos, healer.pos) > radius) continue
        const before = u.hp
        u.hp = Math.min(u.stats.maxHp, u.hp + amount)
        const gained = u.hp - before
        if (gained > 0)
          ctx.log({
            kind: 'heal',
            message: `${healer.name} mends ${u.name} (+${gained} HP).`,
            data: { unitId: u.id, gained },
          })
      }
    },

    // Replace the owner's earned title. The base given name comes from the
    // template, so repeated evolutions swap the epithet rather than stacking
    // into an unwieldy chain.
    append_epithet: (ctx, effect, event) => {
      const pool = effect.pool as string[]
      const epithet = ctx.rng.pick(pool)
      const base = ctx.content.units[event.unit.defId]?.name ?? event.unit.name
      event.unit.name = `${base} ${epithet}`
      ctx.log({
        kind: 'rename',
        message: `${base} is now ${event.unit.name}.`,
        data: { unitId: event.unit.id, epithet },
      })
    },

    // Learn one ability from a pool, excluding any already held. The learned
    // ability's on_gain effects fire at once, so a passive boost lands this
    // instant — the mid-fight "the unit just changed" moment.
    grant_random_ability: (ctx, effect, event) => {
      const unit = event.unit
      const pool = (effect.pool as string[]).filter(
        (id) => !unit.abilities.some((a) => a.id === id),
      )
      if (pool.length === 0) {
        ctx.log({ kind: 'evolve', message: `${unit.name} finds nothing new to learn.` })
        return
      }
      const id = ctx.rng.pick(pool)
      const ability = ctx.content.abilities[id]
      if (!ability) throw new Error(`grant_random_ability: unknown ability "${id}"`)
      unit.abilities.push(ability)
      ctx.log({
        kind: 'evolve',
        message: `${unit.name} learns ${ability.name}!`,
        data: { unitId: unit.id, abilityId: id },
      })
      applyOnGain(ctx, unit, ability)
    },
  }

  function evalCondition(ctx: EffectContext, cond: NonNullable<AbilityDef['condition']>, event: GameEvent): boolean {
    const handler = conditions[cond.type]
    if (!handler) throw new Error(`Unknown condition type "${cond.type}"`)
    return handler(ctx, cond, event)
  }

  function applyEffect(ctx: EffectContext, effect: AbilityDef['effects'][number], event: GameEvent): void {
    const handler = effects[effect.type]
    if (!handler) throw new Error(`Unknown effect type "${effect.type}"`)
    handler(ctx, effect, event)
  }

  function runAbility(ctx: EffectContext, ability: AbilityDef, event: GameEvent): void {
    if (ability.condition && !evalCondition(ctx, ability.condition, event)) return
    for (const effect of ability.effects) applyEffect(ctx, effect, event)
  }

  function dispatch(ctx: EffectContext, event: GameEvent): void {
    // Snapshot the ability list: an ability granted DURING this dispatch (e.g.
    // evolve_on_kill learning an on_kill heal) must not also fire for the very
    // event that granted it. It takes effect from the next matching event on.
    for (const ability of event.unit.abilities.slice()) {
      if (ability.trigger === event.type) runAbility(ctx, ability, event)
    }
  }

  function applyOnGain(ctx: EffectContext, unit: Unit, ability: AbilityDef): void {
    if (ability.trigger !== 'on_gain') return
    // Apply THIS ability's effects only — not a global on_gain sweep, which
    // would re-apply every passive the unit already holds.
    const event: GameEvent = { type: 'on_gain', unit }
    for (const effect of ability.effects) applyEffect(ctx, effect, event)
  }

  return { dispatch, applyOnGain, effects, conditions }
}
