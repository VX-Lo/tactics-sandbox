// The campaign layer's shared vocabulary. This is a strategic/world layer that
// sits ENTIRELY ABOVE the tactics engine and imports nothing from it. Its one
// touchpoint to combat is the `ResolveBattle` socket (below), stubbed by an
// auto-resolver today and to be implemented by the tactics engine later.
//
// This first braid keeps all six design pillars present at their thinnest, with
// ONE pillar — territory/ownership (pillar 4) — given real depth. Everything
// here is plain, serialisable data so a campaign can be snapshotted and replayed.

export type NodeId = string

/**
 * Who owns a settlement. Reserved values `player` and `neutral`; any other value
 * is a faction id from the world data. Ownership is the source of truth for
 * territory and the payoff of the capture verb.
 */
export type Owner = string
export const PLAYER: Owner = 'player'
export const NEUTRAL: Owner = 'neutral'

export type NodeKind = 'settlement' | 'waypoint'

export interface WorldNode {
  id: NodeId
  name: string
  kind: NodeKind
  /**
   * Static defense rating of a settlement — the difficulty of taking the place.
   * This is a fixed property of the map, NOT a managed garrison: there is no
   * garrison/upgrade/income economy (deferred). Waypoints have defense 0.
   */
  defense: number
  /** Layout coordinates in [0,1] for the map view. Presentation only. */
  x: number
  y: number
}

/** Undirected connection with a travel cost (the only thing that consumes time). */
export interface Edge {
  a: NodeId
  b: NodeId
  cost: number
}

export interface Faction {
  id: string
  name: string
  /** Display colour for the map view. */
  color: string
}

/** The STATIC world: geometry + factions. Ownership and parties are mutable
 *  campaign state, not baked in here. */
export interface World {
  nodes: WorldNode[]
  edges: Edge[]
  factions: Faction[]
}

/** A mobile force on the map. Strength is a single scalar — static except for
 *  `resolveBattle` deltas (a future economy is the seam that will change it). */
export interface Party {
  id: string
  /** Faction captures are credited to (`player` or a faction id). */
  faction: Owner
  pos: NodeId
  strength: number
}

// --- the conflict resolver: pillar 6, the combat socket (STUBBED) ----------

/** A force entering a battle. Deliberately minimal — the socket knows nothing of
 *  units, terrain, or the tactics engine. */
export interface BattleParty {
  strength: number
}

export interface BattleOutcome {
  winner: 'attacker' | 'defender'
  /** Strength change for each side (<= 0 casualties). The caller applies these:
   *  the defeated party is removed; the weakened victor persists. */
  attackerDelta: number
  defenderDelta: number
}

/**
 * The SINGLE interface between campaign and combat. The auto-resolver stub
 * implements it now; the real tactics engine will implement the SAME signature
 * and the SAME contract later (see resolve.ts for the variance rule). The
 * campaign never learns which implementation it holds.
 */
export type ResolveBattle = (attacker: BattleParty, defender: BattleParty, seed: number) => BattleOutcome

// --- the loop --------------------------------------------------------------

/** One player order per campaign turn. `travel` advances one edge toward `dest`. */
export type Order =
  | { op: 'travel'; dest: NodeId }
  | { op: 'capture' }
  | { op: 'wait' }

/** A chronicle entry, for the map view and tests. */
export interface CampaignEvent {
  turn: number
  kind: 'capture' | 'defeat' | 'note'
  message: string
}
