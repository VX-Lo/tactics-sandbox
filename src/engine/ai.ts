// A deliberately small, fully deterministic policy: no RNG, tie-breaks by unit
// id and tile key. It is good enough to make the undead a threat and to auto-
// play a battle to conclusion in tests — nothing more. It drives units purely
// through the public Battle command API, so it stays a "player" of the engine,
// not part of it.
//
// Per unit: pick the nearest enemy; if some reachable tile can attack an enemy
// (nearest first), move there and strike; otherwise close the distance toward
// the nearest enemy.

import type { Battle } from './battle'
import { manhattan } from './grid'
import type { Coord, Unit } from './types'

const key = (c: Coord): string => `${c.x},${c.y}`

function inRangeFrom(unit: Unit, from: Coord, targetPos: Coord): boolean {
  const d = manhattan(from, targetPos)
  return d >= unit.attack.minRange && d <= unit.attack.maxRange
}

/** Nearest living enemy to a unit; ties broken by id for determinism. */
function nearestEnemy(battle: Battle, unit: Unit): Unit | undefined {
  const enemies = battle.living().filter((u) => u.faction !== unit.faction)
  let best: Unit | undefined
  let bestD = Infinity
  for (const e of enemies) {
    const d = manhattan(unit.pos, e.pos)
    if (d < bestD || (d === bestD && best && e.id < best.id)) {
      best = e
      bestD = d
    }
  }
  return best
}

/** Execute one unit's whole turn (move and/or attack). Returns true if it acted. */
export function takeUnitTurn(battle: Battle, unit: Unit): boolean {
  if (!unit.alive || unit.hasActed) return false

  const enemies = battle
    .living()
    .filter((u) => u.faction !== unit.faction)
    .sort((a, b) => {
      const da = manhattan(unit.pos, a.pos)
      const db = manhattan(unit.pos, b.pos)
      return da - db || (a.id < b.id ? -1 : 1)
    })
  if (enemies.length === 0) return false

  const stops = [unit.pos, ...battle.destinations(unit)]
  // Prefer to attack: nearest reachable-and-in-range enemy wins.
  for (const enemy of enemies) {
    const spot = stops
      .filter((s) => inRangeFrom(unit, s, enemy.pos))
      .sort((a, b) => (key(a) < key(b) ? -1 : 1))[0]
    if (spot) {
      if (!(spot.x === unit.pos.x && spot.y === unit.pos.y)) battle.moveUnit(unit.id, spot)
      battle.attack(unit.id, enemy.id)
      return true
    }
  }

  // Can't reach anyone: step toward the nearest enemy.
  const target = nearestEnemy(battle, unit)!
  const dests = battle.destinations(unit)
  let best: Coord | undefined
  let bestD = manhattan(unit.pos, target.pos)
  for (const d of dests) {
    const dist = manhattan(d, target.pos)
    if (dist < bestD || (dist === bestD && best && key(d) < key(best))) {
      best = d
      bestD = dist
    }
  }
  if (best) {
    battle.moveUnit(unit.id, best)
    return true
  }
  battle.waitUnit(unit.id)
  return false
}

/** Run the entire current phase with the greedy policy, then end it. */
export function playPhase(battle: Battle): void {
  const faction = battle.state.phase
  // Stable activation order by id; snapshot ids since units may die mid-phase.
  const ids = battle
    .living(faction)
    .map((u) => u.id)
    .sort()
  for (const id of ids) {
    const u = battle.unitById(id)
    if (u && u.alive && !u.hasActed) takeUnitTurn(battle, u)
  }
  battle.endPhase()
}

/**
 * Auto-play a battle to conclusion (or a turn cap) with both sides greedy.
 * Used by tests to exercise a full deterministic run end to end.
 */
export function autoPlay(battle: Battle, turnCap = 200): void {
  while (battle.outcome === 'ongoing' && battle.state.turn <= turnCap) playPhase(battle)
}
