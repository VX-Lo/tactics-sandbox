// The conflict resolver (pillar 6) — the STUB behind the `ResolveBattle` socket.
// This is the strategic layer's equivalent of the run layer's heal-to-full
// placeholder: a deterministic stand-in for the real tactics engine, which will
// later implement this SAME interface under this SAME contract.
//
// THE VARIANCE RULE (load-bearing, must survive the real engine too):
//   - The STRONGER force ALWAYS wins. The seed NEVER decides a non-tie winner.
//   - Equal strength is the ONLY case the seed may decide the winner.
//   - The seed decides only the MARGIN — the casualties the victor suffers.
// This is the anti-save-scum guarantee: you cannot re-roll a battle you were
// always going to win or lose; bring enough force and the outcome is settled, and
// the dice only cost you blood. The real engine must honour the same rule.

import { makeCampaignRng } from './rng'
import type { BattleParty, BattleOutcome } from './types'

export function autoResolve(attacker: BattleParty, defender: BattleParty, seed: number): BattleOutcome {
  const rng = makeCampaignRng(seed)

  // WINNER: strictly by strength. A tie — and ONLY a tie — is broken by the seed.
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
