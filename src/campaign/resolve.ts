// AUTO-RESOLVE: one of the two resolvers behind the `ResolveBattle` socket
// (contracts/battle.ts). Fast, headless, aggregate — the deterministic stand-in
// for real tactics, used for rival-vs-rival fights, player-delegated battles, and
// the overnight balance sim. The real HAND-FIGHT resolver (src/run/battle-resolver.ts)
// satisfies the SAME contract; the campaign never learns which one answered.
//
// THE VARIANCE RULE (load-bearing, CLAUDE.md 1a):
//   - The STRONGER force ALWAYS wins. The seed NEVER decides a non-tie winner.
//   - Equal strength is the ONLY case the seed may decide the winner.
//   - The seed decides only the MARGIN — the casualties the victor suffers.
// This is the anti-save-scum guarantee: you cannot re-roll a battle you were
// always going to win or lose; bring enough force and the outcome is settled, and
// the dice only cost you blood. (The hand-fight path's winner comes from PLAY,
// which is variance-rule-legal because the player chose to expose themselves.)

import { makeCampaignRng } from './rng'
import type { BattleRequest, BattleResult } from '../contracts/battle'

export function autoResolve(request: BattleRequest): BattleResult {
  const { attacker, defender, seed } = request
  const rng = makeCampaignRng(seed)

  // WINNER: strictly by strength. A tie — and ONLY a tie — is broken by the seed.
  // (terrainSeed is deliberately unused: aggregate math never simulates ground.)
  let winnerIsAttacker: boolean
  if (attacker.strength > defender.strength) winnerIsAttacker = true
  else if (defender.strength > attacker.strength) winnerIsAttacker = false
  else winnerIsAttacker = rng.next() < 0.5

  const winStrength = winnerIsAttacker ? attacker.strength : defender.strength
  const loseStrength = winnerIsAttacker ? defender.strength : attacker.strength

  // MARGIN: the victor's casualties. A closer fight (loser nearly as strong)
  // costs more; the seed varies the exact toll within a band. The victor ALWAYS
  // survives (keeps >= 1) — it won, after all.
  const ratio = winStrength === 0 ? 0 : loseStrength / winStrength // (0, 1], 1 == even
  const casualties = Math.max(
    0,
    Math.min(Math.round(winStrength * ratio * (0.3 + 0.5 * rng.next())), winStrength - 1),
  )

  const winnerDelta = -casualties
  const loserDelta = -loseStrength // the loser is spent; the campaign removes it

  return {
    winner: winnerIsAttacker ? 'attacker' : 'defender',
    attackerDelta: winnerIsAttacker ? winnerDelta : loserDelta,
    defenderDelta: winnerIsAttacker ? loserDelta : winnerDelta,
  }
}
