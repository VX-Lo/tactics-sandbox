// Fire Emblem-style combat resolution. One "attack" is a round of up to a few
// blows: the attacker strikes, the defender counters if it can reach back, and
// whichever combatant is meaningfully faster lands a follow-up. Damage is
// deterministic and readable (atk minus effective defense, floored at 1); hit
// clusters high; crits are a minor 1.5x and key off HEIGHT ADVANTAGE, reusing
// the terrain elevation the map already produces.
//
// The design intent — "no single roll decides a battle unless you exposed
// yourself" — falls out of this: variance moves the margin (did a crit land,
// did a high-odds hit whiff), but the outcome is dominated by stats, doubles,
// and positioning, which are the player's to control.
//
// resolveCombat is the one place that mutates HP and marks the dead. It does
// NOT emit events or run abilities — battle orchestration reads the result and
// fires on_kill, so evolution stays outside the combat math.

import type { BattleState, Content, Unit } from './types'
import { manhattan, tileAt } from './grid'

export const FOLLOW_UP_THRESHOLD = 4 // speed lead needed to strike twice
export const MIN_DAMAGE = 1 // an attack that connects always stings
export const CRIT_MULTIPLIER = 1.5
export const ELEVATION_CRIT_PER_LEVEL = 15 // crit % gained per level of height advantage

function elevationAt(state: BattleState, u: Unit): number {
  return tileAt(state.grid, u.pos.x, u.pos.y)?.elevation ?? 0
}

const terrainOf = (state: BattleState, content: Content, u: Unit) =>
  content.terrain[tileAt(state.grid, u.pos.x, u.pos.y)!.terrain]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Is `target` within `attacker`'s attack range from its current position? */
export function inAttackRange(attacker: Unit, target: Unit): boolean {
  const d = manhattan(attacker.pos, target.pos)
  return d >= attacker.attack.minRange && d <= attacker.attack.maxRange
}

/** Hit% before the roll: accuracy + skill, minus the target's terrain avoid. */
export function hitChance(striker: Unit, targetAvoid: number): number {
  return clamp(striker.attack.hit + striker.stats.skl - targetAvoid, 1, 99)
}

/** Pre-crit damage: attack minus effective defense, floored so hits matter. */
export function baseDamage(striker: Unit, target: Unit, targetDefBonus: number): number {
  return Math.max(MIN_DAMAGE, striker.stats.atk - (target.stats.def + targetDefBonus))
}

/** Crit% before the roll: base crit plus a bonus per level of height advantage. */
export function critChance(state: BattleState, striker: Unit, target: Unit): number {
  const advantage = Math.max(0, elevationAt(state, striker) - elevationAt(state, target))
  return clamp(striker.attack.crit + advantage * ELEVATION_CRIT_PER_LEVEL, 0, 99)
}

/** Does `striker` land a follow-up (double) against `target`? */
export function doubles(striker: Unit, target: Unit): boolean {
  return striker.stats.spd - target.stats.spd >= FOLLOW_UP_THRESHOLD
}

export interface Blow {
  strikerId: string
  targetId: string
  hit: boolean
  crit: boolean
  damage: number
  targetHpAfter: number
  killed: boolean
}

export interface Death {
  killerId: string
  victimId: string
}

export interface CombatResult {
  attackerId: string
  defenderId: string
  blows: Blow[]
  deaths: Death[]
}

type Roller = { chance(p: number): boolean }

function strike(state: BattleState, content: Content, rng: Roller, striker: Unit, target: Unit): Blow {
  const targetTerrain = terrainOf(state, content, target)
  const hit = rng.chance(hitChance(striker, targetTerrain.avoidBonus) / 100)

  let damage = 0
  let crit = false
  if (hit) {
    crit = rng.chance(critChance(state, striker, target) / 100)
    const base = baseDamage(striker, target, targetTerrain.defBonus)
    damage = crit ? Math.round(base * CRIT_MULTIPLIER) : base
    target.hp = Math.max(0, target.hp - damage)
  }

  const killed = hit && target.hp === 0
  if (killed) {
    target.alive = false
    striker.kills += 1
  }

  return { strikerId: striker.id, targetId: target.id, hit, crit, damage, targetHpAfter: target.hp, killed }
}

/**
 * Resolve one attack of `attacker` against `defender`. Assumes the attacker has
 * already been placed in range (battle validates that). Mutates HP and marks
 * the dead; returns the blow-by-blow record and the deaths (with killer) for
 * the caller to narrate and to fire on_kill.
 */
export function resolveCombat(
  state: BattleState,
  content: Content,
  rng: Roller,
  attacker: Unit,
  defender: Unit,
): CombatResult {
  const defenderCanCounter = inAttackRange(defender, attacker)

  // Plan the blow order up front; each is executed only if both are still alive
  // (and, for the defender, only if it can reach back). At most one side ever
  // doubles, since only one can lead speed by the threshold.
  const plan: Array<[Unit, Unit]> = [[attacker, defender]]
  if (defenderCanCounter) plan.push([defender, attacker])
  if (doubles(attacker, defender)) plan.push([attacker, defender])
  else if (defenderCanCounter && doubles(defender, attacker)) plan.push([defender, attacker])

  const blows: Blow[] = []
  const deaths: Death[] = []
  for (const [s, t] of plan) {
    if (!s.alive || !t.alive) continue
    const blow = strike(state, content, rng, s, t)
    blows.push(blow)
    if (blow.killed) deaths.push({ killerId: s.id, victimId: t.id })
  }

  return { attackerId: attacker.id, defenderId: defender.id, blows, deaths }
}

// --- Forecast (no rolls) — for UI preview of an engagement --------------------

export interface SideForecast {
  hit: number
  crit: number
  damage: number
  doubles: boolean
}

export interface Forecast {
  attacker: SideForecast
  defender: SideForecast | null // null when the defender cannot counter
}

/** Non-random preview of what resolveCombat would roll against. */
export function forecast(state: BattleState, content: Content, attacker: Unit, defender: Unit): Forecast {
  const dTerr = terrainOf(state, content, defender)
  const aTerr = terrainOf(state, content, attacker)
  const attackerSide: SideForecast = {
    hit: hitChance(attacker, dTerr.avoidBonus),
    crit: critChance(state, attacker, defender),
    damage: baseDamage(attacker, defender, dTerr.defBonus),
    doubles: doubles(attacker, defender),
  }
  const defenderSide: SideForecast | null = inAttackRange(defender, attacker)
    ? {
        hit: hitChance(defender, aTerr.avoidBonus),
        crit: critChance(state, defender, attacker),
        damage: baseDamage(defender, attacker, aTerr.defBonus),
        doubles: doubles(defender, attacker),
      }
    : null
  return { attacker: attackerSide, defender: defenderSide }
}
