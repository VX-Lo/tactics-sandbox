// The campaign's economy: two accumulating resources (Scrip, Stores), flat
// node-based income, roster upkeep with tiered failure, and a deterministic
// rival spending policy. Tunables live in data/economy.json so retuning never
// touches this file (data-not-code, matching the rest of data/).
//
// ROSTER SEAM (the real contract, not a stub):
// Upkeep reads a unit's tier and, on a shortfall, either removes it (levy),
// benches it MIA (supporting), or debts it (named). The tier and the removal
// are RUN-LAYER truth reached through the `RosterPort` interface (defined in
// src/contracts/roster.ts, dependency-inverted so the campaign never imports the
// run module). The MIA countdown and the Scrip debt, by contrast, are the
// economy's OWN bookkeeping — meaningless outside this layer — so they live here
// in the `UpkeepLedger`, keyed by unit id, never on run-layer units. See the
// contract file for the full rationale of the split.

import economyData from '../../data/economy.json'
import type { CampaignRng } from './rng'
import type { Owner } from './types'
import type { RosterPort, RosterTier, RosterUnitRef } from '../contracts/roster'

export type { RosterPort, RosterUnitRef } from '../contracts/roster'
/** @deprecated Use RosterTier from the roster contract. Kept for world.ts's seed typing. */
export type EconomyTier = RosterTier

export interface Resources {
  scrip: number
  stores: number
}

// --- the campaign-owned upkeep ledger (MIA / debt) ---------------------------
// This state is the economy's, NOT the run layer's: it never crosses the
// RosterPort. Keyed by (faction, unit id) so it lines up with the port's units.

/** One unit's upkeep-failure status. Absent from the ledger == the healthy zero. */
export interface UnitUpkeep {
  /** Supporting-tier failure: benched until `miaReturnsAtTick`, excluded from upkeep. */
  mia: boolean
  miaReturnsAtTick: number | null
  /** Named-tier failure: interest-bearing Scrip debt. Non-zero == non-deployable. */
  debt: number
}

const HEALTHY: UnitUpkeep = { mia: false, miaReturnsAtTick: null, debt: 0 }

/** A unit joined with its upkeep status — the campaign's read-only roster VIEW
 *  (port truth + ledger bookkeeping), for the UI and snapshots. */
export type RosterUnitState = RosterUnitRef & UnitUpkeep

/**
 * The campaign's per-unit MIA/debt bookkeeping. A plain id-keyed store; entries
 * are created lazily and default to HEALTHY, so a unit the economy has never
 * failed to pay simply isn't in the map. Pure in-memory campaign state.
 */
export interface UpkeepLedger {
  /** Current status for a unit (the healthy zero if it has never failed upkeep). */
  status(faction: Owner, unitId: string): UnitUpkeep
  setMia(faction: Owner, unitId: string, returnsAtTick: number): void
  clearMia(faction: Owner, unitId: string): void
  setDebt(faction: Owner, unitId: string, debt: number): void
}

export function makeUpkeepLedger(): UpkeepLedger {
  const byFaction = new Map<Owner, Map<string, UnitUpkeep>>()
  const bucket = (faction: Owner) => {
    let b = byFaction.get(faction)
    if (!b) {
      b = new Map()
      byFaction.set(faction, b)
    }
    return b
  }
  const entry = (faction: Owner, unitId: string) => {
    const b = bucket(faction)
    let e = b.get(unitId)
    if (!e) {
      e = { ...HEALTHY }
      b.set(unitId, e)
    }
    return e
  }
  return {
    status: (faction, unitId) => byFaction.get(faction)?.get(unitId) ?? HEALTHY,
    setMia: (faction, unitId, returnsAtTick) => {
      const e = entry(faction, unitId)
      e.mia = true
      e.miaReturnsAtTick = returnsAtTick
    },
    clearMia: (faction, unitId) => {
      const e = entry(faction, unitId)
      e.mia = false
      e.miaReturnsAtTick = null
    },
    setDebt: (faction, unitId, debt) => {
      entry(faction, unitId).debt = debt
    },
  }
}

// --- in-memory RosterPort (for factions with no live run) --------------------

export interface RosterSeed {
  faction: Owner
  units: Array<{ id: string; tier: RosterTier }>
}

/**
 * A real, in-memory implementation of the RosterPort — the one used for factions
 * that have no live run-layer roster (the rival, and the player until the run
 * layer is wired into the campaign). Seeded from world data. This is NOT a stub:
 * it satisfies the same contract as the run-backed adapter (src/run/roster-port.ts);
 * only its backing store differs (a plain array vs a live Run's roster).
 */
export function makeInMemoryRosterPort(seeds: RosterSeed[]): RosterPort {
  const rosters = new Map<Owner, RosterUnitRef[]>(
    seeds.map((s) => [s.faction, s.units.map((u) => ({ id: u.id, tier: u.tier }))]),
  )
  return {
    factions: () => [...rosters.keys()],
    units: (faction) => rosters.get(faction) ?? [],
    removeUnit: (faction, unitId) => {
      rosters.set(faction, (rosters.get(faction) ?? []).filter((u) => u.id !== unitId))
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
  tier: RosterTier
  outcome: 'lost' | 'mia' | 'debt'
}

/**
 * Pay Stores upkeep for one faction's active (non-MIA) roster, highest tier
 * first (named -> supporting -> levy) so a shortfall bites the levies before
 * it touches anyone with a name — money runs out at the bottom of the
 * hierarchy, not the top. Ties within a tier break by unit id for a stable,
 * replayable order. A unit whose upkeep can't be covered fails per its tier:
 *   - levy: removed from the roster (spent) — the one failure that crosses the
 *     RosterPort into real run-layer state.
 *   - supporting: MIA in the ledger, returns automatically after config.miaReturnTicks.
 *   - named: added to its ledger Scrip-debt (interest applied by the caller —
 *     see tickEconomy); stays on the roster, non-deployable.
 * Reads tier through `port`; reads/writes MIA/debt through `ledger`. Mutates
 * `port`, `ledger`, and `bank.stores` in place.
 */
export function payUpkeep(
  port: RosterPort,
  ledger: UpkeepLedger,
  faction: Owner,
  bank: Resources,
  currentTick: number,
  config: EconomyConfig,
): UpkeepFailure[] {
  const priority: RosterTier[] = ['named', 'supporting', 'levy']
  const active = port
    .units(faction)
    .filter((u) => !ledger.status(faction, u.id).mia)
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
      ledger.setMia(faction, unit.id, currentTick + config.miaReturnTicks)
      failures.push({ unitId: unit.id, tier: 'supporting', outcome: 'mia' })
    } else {
      const debt = ledger.status(faction, unit.id).debt
      ledger.setDebt(faction, unit.id, debt + cost * config.debtConversionRate)
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
  ledger: UpkeepLedger,
  faction: Owner,
  bank: Resources,
  ownedSettlementCount: number,
  currentTick: number,
  config: EconomyConfig,
  rng: CampaignRng,
): EconomyTickResult {
  const miaReturned: string[] = []
  for (const u of port.units(faction)) {
    const s = ledger.status(faction, u.id)
    if (s.mia && s.miaReturnsAtTick !== null && currentTick >= s.miaReturnsAtTick) {
      ledger.clearMia(faction, u.id)
      miaReturned.push(u.id)
    }
  }

  const income = computeIncome(ownedSettlementCount, config, rng)
  bank.scrip += income.scrip
  bank.stores += income.stores

  const failures = payUpkeep(port, ledger, faction, bank, currentTick, config)

  for (const u of port.units(faction)) {
    const debt = ledger.status(faction, u.id).debt
    if (u.tier !== 'named' || debt <= 0) continue
    const withInterest = Math.round(debt * (1 + config.debtInterestRate))
    if (bank.scrip >= withInterest) {
      bank.scrip -= withInterest
      ledger.setDebt(faction, u.id, 0)
    } else {
      ledger.setDebt(faction, u.id, withInterest)
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
