// The campaign<->run-layer roster contract. This is the REAL interface that
// replaced the old stubbed placeholder port (CLAUDE.md's flagged "Kaname pass").
//
// WHY THIS FILE EXISTS (the boundary it protects):
// The campaign layer must import NOTHING from tactics internals (CLAUDE.md
// section 2), and the run layer sits ABOVE tactics (it imports the engine). So
// if the campaign imported the run module to read roster state, it would
// transitively drag in tactics. Dependency inversion fixes this: the PORT lives
// here, in a layer-neutral module that imports neither tactics, run, nor
// campaign internals. The campaign depends only on this interface; the run layer
// provides an implementation of it (src/run/roster-port.ts); they are wired at
// the composition root via CampaignOptions.rosterPort. Neither layer imports the
// other.
//
// WHAT CROSSES THE BOUNDARY (the "one system or two" call — TWO systems):
// This port carries ONLY what the run layer authoritatively owns and the
// campaign cannot fabricate: which units exist, each unit's tier, and the
// authority to permanently remove one (permadeath). The campaign economy's own
// failure bookkeeping — a supporting unit's MIA countdown, a named unit's Scrip
// debt — does NOT cross this boundary: those are economy inventions (meaningless
// without Scrip/Stores) and live entirely in the campaign layer's UpkeepLedger
// (src/campaign/economy.ts), keyed by the same unit ids. Keeping MIA/debt off
// this port is deliberate: it stops any implementer from writing Scrip concepts
// onto run-layer units and keeps the run layer runnable with no notion of money.

/**
 * A unit's attachment tier, low→high. `levy` (spent) and `named` (mourned) exist
 * in the run layer today; the middle `supporting` tier is planned (its MIA
 * mechanic already exists on the campaign side). Insert new tiers in low→high
 * order — nothing here branches on the specific values.
 */
export type RosterTier = 'levy' | 'supporting' | 'named'

/** The run layer's authoritative view of one roster unit: identity + tier only. */
export interface RosterUnitRef {
  id: string
  tier: RosterTier
}

/**
 * The read/command surface the campaign economy needs over run-layer roster
 * state. Faction ids are plain strings (the campaign's `Owner`). Implementations:
 *   - src/run/roster-port.ts  — the real adapter over a live run-layer roster.
 *   - src/campaign/economy.ts — an in-memory implementation for factions that
 *     have no live run (the rival, and the player before run-integration).
 */
export interface RosterPort {
  /** Factions this port knows a roster for. */
  factions(): string[]
  /** A faction's current units (identity + tier). Removed units are absent. */
  units(faction: string): RosterUnitRef[]
  /**
   * Permanently remove a unit from the faction's roster — the run-layer
   * permadeath a spent levy suffers on an upkeep shortfall. Irreversible;
   * no-op if the unit is already gone.
   */
  removeUnit(faction: string, unitId: string): void
}
