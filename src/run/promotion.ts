// The run's two tunable knobs — promotion trigger + recovery rate — kept side by
// side because they are the deliberate, hand-tuned variables of the run layer.
// Both are pure and deterministic: no RNG, no engine mutation, no PRNG stream
// touched. Wounds and promotions are functions of state that already exists.
//
// PROMOTION (identity genesis). Design intent is "a levy focus-targeted by >= 3
// distinct enemy units and endured" — a readout of what already happened in the
// deterministic battle. The engine does not record distinct attackers, and
// adding that would be an engine RULES-LOGIC change (combat resolution / event
// flow), out of scope. So we use the sanctioned substitute: the unit's HP
// crossed DOWN through 40% of max this battle — it started at/above the line and
// was driven below it, surviving to the end — read from the combat chronicle's
// structured blow data. The "started at/above" half is what keeps a unit that
// began the battle already wounded (below 40%) from auto-promoting merely by
// surviving; recovery makes such starts possible, so the crossing is required.
//
// If distinct-attacker tracking is ever added to the engine, swap the readout
// here for it; nothing else about the system changes.

import type { LogEntry, Unit } from '../engine/types'

/** Fraction of max HP a unit must cross DOWN through (and survive) to earn a name. */
export const PROMOTION_HP_FRACTION = 0.4

/**
 * Fraction of max HP a surviving unit knits back per encounter — the wound/
 * recovery rate. Replaces heal-to-full: wounds are just current HP that hasn't
 * caught up to max yet, and this is how fast it catches up. Pure and
 * deterministic; see recoveredHp.
 */
export const RECOVERY_FRACTION = 0.25

/**
 * Current HP after one encounter's recovery. Integer, deterministic, no RNG:
 * heal a fixed step of max(1, floor(RECOVERY_FRACTION * maxHp)), capped at maxHp.
 * maxHp is NEVER modified — recovery only moves current HP toward it. Callers
 * must not apply this to the dead (permadeath stands).
 */
export function recoveredHp(currentHp: number, maxHp: number): number {
  const step = Math.max(1, Math.floor(RECOVERY_FRACTION * maxHp))
  return Math.min(maxHp, currentHp + step)
}

/**
 * The lowest HP `unitId` was driven to by any landed blow in this battle's log,
 * or `fallback` if it was never hit. Reads the structured `data` of combat
 * entries (`{ targetId, targetHpAfter, ... }` — the Blow record); narration text
 * is never parsed. A mid-battle heal raises HP but is not a blow, so it never
 * masks a low-water mark the unit actually reached.
 */
export function lowestHpReached(log: LogEntry[], unitId: string, fallback: number): number {
  let lowest = fallback
  for (const e of log) {
    const d = e.data
    if (e.kind !== 'combat' || !d || d.targetId !== unitId) continue
    const hpAfter = d.targetHpAfter
    if (typeof hpAfter === 'number') lowest = Math.min(lowest, hpAfter)
  }
  return lowest
}

/**
 * Did this unit's HP cross DOWN through the promotion threshold this battle?
 * True iff it STARTED at/above PROMOTION_HP_FRACTION of max AND its in-battle
 * low-water mark fell below it. `startHp` is the unit's HP when the battle began
 * (which recovery may leave below max); it doubles as the low-water fallback for
 * a unit that was never hit. The caller owns the rest (deployed, survived, still
 * a levy) — a unit that entered already below the line cannot promote here.
 */
export function enduredFocus(unit: Unit, log: LogEntry[], startHp: number): boolean {
  const threshold = unit.stats.maxHp * PROMOTION_HP_FRACTION
  const lowest = lowestHpReached(log, unit.id, startHp)
  return startHp >= threshold && lowest < threshold
}
