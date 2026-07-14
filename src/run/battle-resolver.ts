// HAND-FIGHT resolver: the second implementation of the ResolveBattle socket
// (contracts/battle.ts), backed by a REAL tactics battle instead of aggregate
// math. This is deliberately thin — it is the WIRING that proves the two-path
// model is real, assembled almost entirely from seams that already exist:
//   - Battle already accepts injected pre-built `playerUnits` (run-agnostic).
//   - `autoPlay` already drives a battle to conclusion deterministically.
//   - The run layer already observes battle outcomes via the event bus and
//     applies XP/death/promotion (Run.finishBattle) — NOT this resolver's job.
// It lives in the run layer (may read run/engine internals) and imports NOTHING
// from src/campaign; the contract types come from the neutral contracts module,
// so the dependency arrow points run -> contracts, never run -> campaign.
//
// Boundary with the campaign (CLAUDE.md): the campaign hands over opaque force
// HANDLES (faction + aggregate strength); THIS side resolves the attacker handle
// to real units and returns a STRICTLY AGGREGATE BattleResult. Unit truth stays
// here: the fielded units are mutated in place (hp/alive), which is how the run
// roster sees wounds and deaths; the campaign then learns named casualties by
// diffing the roster through the port (never from this result).
//
// DEFERRED (resolver-internal, per this pass's non-goals):
//   - Garrison COMPOSITION from a settlement's defense scalar (placeholder:
//     N skeletons) — the real defender content is a later call.
//   - The strength<->units CALIBRATION (how a battle's unit losses map back to a
//     campaign strength delta) — provisional proportional mapping below.
//   - Node-stable TERRAIN from request.terrainSeed — currently the battle's own
//     seed drives the map; a distinct map seed is a future additive BattleOptions
//     field. The contract already CARRIES terrainSeed, which is the load-bearing part.
//   - Player-DRIVEN play (real hand-fight UX) replacing autoPlay — the polished
//     flow. autoPlay stands in so the path is exercisable and deterministic now.

import { Battle } from '../engine/battle'
import { autoPlay } from '../engine/ai'
import type { Content, Unit } from '../engine/types'
import type { BattleRequest, BattleResult, ResolveBattle } from '../contracts/battle'

export interface BattleResolverDeps {
  /**
   * The real units to field for the attacking faction (run-owned — e.g. the live
   * deployed roster). Mutated in place by the battle; the run layer applies the
   * roster consequences (culling the dead, XP, promotion) separately.
   */
  fieldAttacker(faction: string): Unit[]
  /** Content the placeholder garrison is instantiated from. */
  content: Content
  /** Enemy def id for the placeholder garrison (defaults to a levy skeleton). */
  garrisonDefId?: string
}

/** Clamp a victor's casualties so it always survives with >= 1 strength — the
 *  same guarantee the auto-resolver makes for a winner. */
function survivorDelta(strength: number, lossFraction: number): number {
  const casualties = Math.max(0, Math.min(Math.round(strength * lossFraction), Math.max(0, strength - 1)))
  return -casualties
}

export function makeBattleResolveBattle(deps: BattleResolverDeps): ResolveBattle {
  const garrisonDefId = deps.garrisonDefId ?? 'skeleton'
  return (request: BattleRequest): BattleResult => {
    const attackers = deps.fieldAttacker(request.attacker.faction)

    // No force to field -> the assault never lands; the defender holds.
    if (attackers.length === 0) {
      return { winner: 'defender', attackerDelta: -request.attacker.strength, defenderDelta: 0 }
    }

    // Placeholder garrison sized from the settlement's defense scalar.
    const size = Math.max(1, Math.round(request.defender.strength))
    const enemyRoster = Array.from({ length: size }, () => garrisonDefId)

    const battle = new Battle({
      seed: request.seed,
      content: deps.content,
      playerUnits: attackers,
      enemyRoster,
    })
    autoPlay(battle)

    const fielded = attackers.length
    const attackerSurvivors = attackers.filter((u) => u.alive).length
    const enemySurvivors = battle.living('enemy').length

    // A settlement assault: the attacker WINS only on a clean sweep (player_win).
    // A stalemate or a wipe means the assault was repelled -> defender holds.
    if (battle.outcome === 'player_win') {
      return {
        winner: 'attacker',
        attackerDelta: survivorDelta(request.attacker.strength, (fielded - attackerSurvivors) / fielded),
        defenderDelta: -request.defender.strength, // the garrison is spent; the node flips
      }
    }
    return {
      winner: 'defender',
      attackerDelta: -request.attacker.strength, // the party is spent (campaign removes it)
      defenderDelta: survivorDelta(request.defender.strength, (size - enemySurvivors) / size),
    }
  }
}
