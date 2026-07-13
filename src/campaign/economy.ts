// The campaign's economy: two accumulating resources (Scrip, Stores), flat
// node-based income, roster upkeep with tiered failure, and a deterministic
// rival spending policy. Tunables live in data/economy.json so retuning never
// touches this file (data-not-code, matching the rest of data/).
//
// STUBBED SEAM: upkeep needs to read a roster unit's tier and mutate roster
// state (remove a levy, MIA a supporting unit, debt a named one). The real
// roster lives in the run layer, which the campaign module must never import
// (CLAUDE.md section 2). `RosterPort` is the placeholder standing in for that
// not-yet-designed campaign<->run contract — a plain interface, not a real
// integration. `makeStubRosterPort` is an in-memory, world-data-seeded
// implementation good enough to play and test against today. Swapping in the
// real run-layer roster later means replacing what implements this port, not
// rearchitecting the campaign. THIS IS A KANAME/OPUS QUESTION TO DESIGN FOR
// REAL — do not extend this stub into a real contract.

import economyData from '../../data/economy.json'
import type { CampaignRng } from './rng'
import type { Owner } from './types'

export type EconomyTier = 'levy' | 'supporting' | 'named'

export interface Resources {
  scrip: number
  stores: number
}

/** A roster unit as the economy needs to see it. See STUBBED SEAM above. */
export interface RosterUnitStub {
  id: string
  tier: EconomyTier
  /** Supporting-tier upkeep failure: off the active roster until it returns. */
  mia: boolean
  miaReturnsAtTick: number | null
  /** Named-tier upkeep failure: Scrip-denominated, interest-bearing, unpaid
   *  Stores debt. Non-zero means non-deployable. */
  debt: number
}

/** The stand-in campaign<->run interface (see STUBBED SEAM above). */
export interface RosterPort {
  factions(): Owner[]
  units(faction: Owner): RosterUnitStub[]
  removeUnit(faction: Owner, unitId: string): void
  setMia(faction: Owner, unitId: string, returnsAtTick: number): void
  clearMia(faction: Owner, unitId: string): void
  setDebt(faction: Owner, unitId: string, debt: number): void
}

export interface RosterSeed {
  faction: Owner
  units: Array<{ id: string; tier: EconomyTier }>
}

/** In-memory RosterPort seeded from world data. Not the real contract — see
 *  STUBBED SEAM above. */
export function makeStubRosterPort(seeds: RosterSeed[]): RosterPort {
  const rosters = new Map<Owner, RosterUnitStub[]>(
    seeds.map((s) => [s.faction, s.units.map((u) => ({ id: u.id, tier: u.tier, mia: false, miaReturnsAtTick: null, debt: 0 }))]),
  )
  return {
    factions: () => [...rosters.keys()],
    units: (faction) => rosters.get(faction) ?? [],
    removeUnit: (faction, unitId) => {
      rosters.set(faction, (rosters.get(faction) ?? []).filter((u) => u.id !== unitId))
    },
    setMia: (faction, unitId, returnsAtTick) => {
      const u = (rosters.get(faction) ?? []).find((u) => u.id === unitId)
      if (u) {
        u.mia = true
        u.miaReturnsAtTick = returnsAtTick
      }
    },
    clearMia: (faction, unitId) => {
      const u = (rosters.get(faction) ?? []).find((u) => u.id === unitId)
      if (u) {
        u.mia = false
        u.miaReturnsAtTick = null
      }
    },
    setDebt: (faction, unitId, debt) => {
      const u = (rosters.get(faction) ?? []).find((u) => u.id === unitId)
      if (u) u.debt = debt
    },
  }
}

// --- data-driven tunables ----------------------------------------------------

export interface EconomyConfig {
  startingScrip: number
  startingStores: number
  nodeYield: Resources
  yieldVariance: number
  captureCost: number
  upkeepCost: Record<EconomyTier, number>
  debtInterestRate: number
  debtConversionRate: number
  miaReturnTicks: number
  rivalPolicy: { expandThreshold: number; reactionLagTicks: number }
}

/** The bundled default tuning. Campaigns may override via CampaignOptions
 *  (handy for tests that want to pin down jitter/thresholds exactly). */
export const ECONOMY: EconomyConfig = economyData as EconomyConfig

// --- accumulation ------------------------------------------------------------

/**
 * Flat per-node yield * owned settlement count, with small independent seeded
 * jitter on each resource. The SAME formula regardless of node count — owning
 * 1 vs 20 settlements is one multiply, never a different code path.
 *
 * Variance rule note: jitter only ever changes how much is BANKED this tick —
 * it never by itself decides an upkeep failure. A faction sitting on any real
 * reserve can't be tipped into failure by jitter alone; only a bank already
 * run down to (near) zero — the player's/rival's own prior spending — can let
 * jitter be the difference. That's the variance rule's existing shape (margin,
 * not outcome, unless the risk was already chosen) falling out for free.
 */
export function computeIncome(ownedSettlementCount: number, config: EconomyConfig, rng: CampaignRng): Resources {
  const jitter = () => 1 + (rng.next() * 2 - 1) * config.yieldVariance
  return {
    scrip: Math.round(ownedSettlementCount * config.nodeYield.scrip * jitter()),
    stores: Math.round(ownedSettlementCount * config.nodeYield.stores * jitter()),
  }
}

// --- upkeep ------------------------------------------------------------------

export interface UpkeepFailure {
  unitId: string
  tier: EconomyTier
  outcome: 'lost' | 'mia' | 'debt'
}

/**
 * Pay Stores upkeep for one faction's active (non-MIA) roster, highest tier
 * first (named -> supporting -> levy) so a shortfall bites the levies before
 * it touches anyone with a name — money runs out at the bottom of the
 * hierarchy, not the top. Ties within a tier break by unit id for a stable,
 * replayable order. A unit whose upkeep can't be covered fails per its tier:
 *   - levy: removed from the roster (spent).
 *   - supporting: MIA, returns automatically after config.miaReturnTicks.
 *   - named: added to its Scrip-denominated debt (interest applied by the
 *     caller — see tickEconomy); stays on the roster, non-deployable.
 * Mutates `port` and `bank.stores` in place.
 */
export function payUpkeep(
  port: RosterPort,
  faction: Owner,
  bank: Resources,
  currentTick: number,
  config: EconomyConfig,
): UpkeepFailure[] {
  const priority: EconomyTier[] = ['named', 'supporting', 'levy']
  const active = port
    .units(faction)
    .filter((u) => !u.mia)
    .sort((a, b) => {
      const pa = priority.indexOf(a.tier)
      const pb = priority.indexOf(b.tier)
      return pa !== pb ? pa - pb : a.id < b.id ? -1 : 1
    })

  const failures: UpkeepFailure[] = []
  for (const unit of active) {
    const cost = config.upkeepCost[unit.tier]
    if (bank.stores >= cost) {
      bank.stores -= cost
      continue
    }
    if (unit.tier === 'levy') {
      port.removeUnit(faction, unit.id)
      failures.push({ unitId: unit.id, tier: 'levy', outcome: 'lost' })
    } else if (unit.tier === 'supporting') {
      port.setMia(faction, unit.id, currentTick + config.miaReturnTicks)
      failures.push({ unitId: unit.id, tier: 'supporting', outcome: 'mia' })
    } else {
      port.setDebt(faction, unit.id, unit.debt + cost * config.debtConversionRate)
      failures.push({ unitId: unit.id, tier: 'named', outcome: 'debt' })
    }
  }
  return failures
}

// --- one campaign tick's worth of economy, for one faction -------------------

export interface EconomyTickResult {
  income: Resources
  failures: UpkeepFailure[]
  miaReturned: string[]
}

/**
 * One tick of economy for one faction: MIA units due back rejoin first (fed
 * again as of the tick they return), income lands, upkeep is paid (or fails,
 * tiered), then every named unit's outstanding debt accrues interest and is
 * auto-paid off if the faction can now afford it (the only repayment path
 * this pass builds — a plain sweep, not a player-facing order).
 */
export function tickEconomy(
  port: RosterPort,
  faction: Owner,
  bank: Resources,
  ownedSettlementCount: number,
  currentTick: number,
  config: EconomyConfig,
  rng: CampaignRng,
): EconomyTickResult {
  const miaReturned: string[] = []
  for (const u of port.units(faction)) {
    if (u.mia && u.miaReturnsAtTick !== null && currentTick >= u.miaReturnsAtTick) {
      port.clearMia(faction, u.id)
      miaReturned.push(u.id)
    }
  }

  const income = computeIncome(ownedSettlementCount, config, rng)
  bank.scrip += income.scrip
  bank.stores += income.stores

  const failures = payUpkeep(port, faction, bank, currentTick, config)

  for (const u of port.units(faction)) {
    if (u.tier !== 'named' || u.debt <= 0) continue
    const withInterest = Math.round(u.debt * (1 + config.debtInterestRate))
    if (bank.scrip >= withInterest) {
      bank.scrip -= withInterest
      port.setDebt(faction, u.id, 0)
    } else {
      port.setDebt(faction, u.id, withInterest)
    }
  }

  return { income, failures, miaReturned }
}

// --- rival spending policy ----------------------------------------------------

/**
 * Pure decision step for the rival's "pay upkeep first, then maybe expand"
 * policy: upkeep already happened in tickEconomy (called first — see
 * campaign.ts's turn order); this just tracks how many consecutive ticks the
 * faction has held Scrip at/above the expand threshold, and says whether the
 * reaction lag has cleared. Pure and deterministic (no rng — the lag is a
 * plain counter): given the same scrip-over-time sequence, it reproduces
 * identically every time.
 */
export function rivalExpandDecision(
  scrip: number,
  priorStreak: number,
  config: EconomyConfig,
): { ready: boolean; streak: number } {
  const meets = scrip >= config.rivalPolicy.expandThreshold
  const streak = meets ? priorStreak + 1 : 0
  return { ready: streak >= config.rivalPolicy.reactionLagTicks, streak }
}
