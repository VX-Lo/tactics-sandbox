// The campaign's chronicle: turns a tick's ALREADY-DECIDED outcome (from
// economy.ts / campaign.ts) into typed, displayable event records. This module
// makes no decisions and introduces no randomness or timing — it only
// describes what already happened, so it can be pure and unit-tested on its
// own, independent of Campaign/DOM. Rendering (the actual HTML/CSS) stays in
// campaign-view.ts; this file stops at "record" and "display string."
//
// No unit names/ids appear anywhere here — upkeep failures and MIA returns are
// generic-by-tier, matching the run layer's own no-names-for-levies stance.

import type { EconomyTier, UpkeepFailure } from './economy'
import type { NodeId, Owner } from './types'

export type CampaignLogEvent =
  | { kind: 'capture'; faction: Owner; node: NodeId; strength: number }
  | { kind: 'defeat'; faction: Owner; node: NodeId }
  | { kind: 'capture-blocked'; faction: Owner; node: NodeId }
  | { kind: 'upkeep-lost'; faction: Owner }
  | { kind: 'upkeep-mia'; faction: Owner }
  | { kind: 'upkeep-debt'; faction: Owner }
  | { kind: 'mia-return'; faction: Owner }
  | { kind: 'rival-hold'; faction: Owner }
  | { kind: 'rival-expand'; faction: Owner }

const UPKEEP_KIND: Record<EconomyTier, 'upkeep-lost' | 'upkeep-mia' | 'upkeep-debt'> = {
  levy: 'upkeep-lost',
  supporting: 'upkeep-mia',
  named: 'upkeep-debt',
}

/** One event per unit that failed upkeep this tick, tier-generic (no ids). */
export function upkeepFailureEvents(faction: Owner, failures: UpkeepFailure[]): CampaignLogEvent[] {
  return failures.map((f) => ({ kind: UPKEEP_KIND[f.tier], faction }))
}

/** One event per unit that rejoined the roster from MIA this tick. */
export function miaReturnEvents(faction: Owner, miaReturned: string[]): CampaignLogEvent[] {
  return miaReturned.map(() => ({ kind: 'mia-return', faction }))
}

export function captureWonEvent(faction: Owner, node: NodeId, strength: number): CampaignLogEvent {
  return { kind: 'capture', faction, node, strength }
}
export function captureLostEvent(faction: Owner, node: NodeId): CampaignLogEvent {
  return { kind: 'defeat', faction, node }
}
export function captureBlockedEvent(faction: Owner, node: NodeId): CampaignLogEvent {
  return { kind: 'capture-blocked', faction, node }
}

/**
 * The rival's (or any faction's) spending policy resolving visibly, one event
 * per transition, never repeated every tick it holds:
 *   - `rival-expand`: the reaction lag JUST cleared this tick (was not ready,
 *     is now) — the moment it starts pursuing its next capture.
 *   - `rival-hold`: it has real surplus (meets the threshold) but the lag
 *     hasn't cleared yet — makes the previously-invisible wait legible.
 * Returns null on any tick that's neither (below threshold, or already
 * mid-expansion with nothing new to report).
 */
export function rivalPolicyEvent(faction: Owner, meetsThreshold: boolean, wasReady: boolean, isReady: boolean): CampaignLogEvent | null {
  if (isReady && !wasReady) return { kind: 'rival-expand', faction }
  if (meetsThreshold && !isReady) return { kind: 'rival-hold', faction }
  return null
}

export interface LogEventContext {
  factionName: (faction: Owner) => string
  nodeName: (node: NodeId) => string
}

/** Pure record -> display string. No DOM, no HTML — campaign-view.ts wraps this. */
export function describeCampaignLogEvent(e: CampaignLogEvent, ctx: LogEventContext): string {
  const who = ctx.factionName(e.faction)
  switch (e.kind) {
    case 'capture':
      return `${who} captured ${ctx.nodeName(e.node)} (strength now ${e.strength}).`
    case 'defeat':
      return `${who}'s warband was destroyed assaulting ${ctx.nodeName(e.node)}.`
    case 'capture-blocked':
      return `${who} cannot afford to move on ${ctx.nodeName(e.node)}.`
    case 'upkeep-lost':
      return `${who} cannot feed a levy — it is lost.`
    case 'upkeep-mia':
      return `${who} cannot feed a unit — it goes missing.`
    case 'upkeep-debt':
      return `${who} cannot feed a named unit — the debt grows.`
    case 'mia-return':
      return `A missing unit rejoins ${who}'s roster.`
    case 'rival-hold':
      return `${who} holds its coffers, weighing the next move.`
    case 'rival-expand':
      return `${who} moves to expand.`
  }
}
