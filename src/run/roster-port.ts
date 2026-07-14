// The run-layer side of the campaign<->run roster contract: a real RosterPort
// (src/contracts/roster.ts) backed by a LIVE run-layer roster. This is the
// concrete adapter a future session drops in when the campaign starts driving
// actual runs — where `removeUnit` (an upkeep-starved levy) genuinely deletes a
// unit from the run's roster, the same permadeath a battle death causes.
//
// Boundary note: this file lives in the run layer and may read run internals,
// but it imports NOTHING from src/campaign — the faction id is passed in as a
// plain string (the campaign's `Owner`), so the dependency arrow points only
// run -> contract, never run -> campaign.

import type { RosterPort } from '../contracts/roster'
import type { RosterEntry } from './run'

/**
 * The live roster this adapter reads and mutates. Structural (not the full `Run`
 * class) so the adapter couples to nothing more than "something holding a mutable
 * RosterEntry[]" — a real `Run` satisfies it, and so does a test double. Removal
 * reassigns `roster`, mirroring how the run layer itself culls the dead.
 */
export interface RunRosterHandle {
  roster: RosterEntry[]
}

/**
 * A RosterPort over one faction's live run-layer roster. A run represents a
 * single faction's units, so this port answers for exactly `faction` and reports
 * an empty roster for any other. Unit tier (`levy`/`named` today) flows straight
 * through — it is already a subset of the contract's RosterTier.
 */
export function makeRunRosterPort(faction: string, handle: RunRosterHandle): RosterPort {
  return {
    factions: () => [faction],
    units: (f) =>
      f === faction ? handle.roster.map((e) => ({ id: e.unit.id, tier: e.unit.tier, name: e.unit.name })) : [],
    removeUnit: (f, unitId) => {
      if (f !== faction) return
      handle.roster = handle.roster.filter((e) => e.unit.id !== unitId)
    },
  }
}
