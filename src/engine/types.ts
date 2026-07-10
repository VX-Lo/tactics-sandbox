// The shared vocabulary of the engine. Everything here is either plain,
// serialisable data (so a battle can be snapshotted and replayed) or the small
// set of function-type "seams" that let subsystems talk without importing each
// other. Keeping the vocabulary in one place is what lets movement, combat, and
// abilities stay mutually ignorant.

import type { Rng } from './rng'

export interface Coord {
  x: number
  y: number
}

export type Faction = 'player' | 'enemy'

export interface Stats {
  maxHp: number
  atk: number
  def: number
  /** Governs follow-up attacks: a lead of >= FOLLOW_UP_THRESHOLD earns a double. */
  spd: number
  /** Feeds hit and crit accuracy. */
  skl: number
}

// --- Terrain -----------------------------------------------------------------
// Terrain is data, like everything else: the generator emits tiles that name a
// terrain id, and the rules read the id's definition. Adding a terrain kind is
// a data edit, never an engine edit.

export interface TerrainDef {
  id: string
  name: string
  /** Tile fill colour for the UI (engine ignores it). */
  color: string
  /** Base movement points to ENTER a tile of this terrain. */
  moveCost: number
  /** Flat defense granted to the occupant. */
  defBonus: number
  /** Reduces incoming hit chance against the occupant. */
  avoidBonus: number
  /** Impassable terrain (walls, deep water) blocks movement outright. */
  passable: boolean
}

export interface Tile {
  x: number
  y: number
  /** Continuous height from the noise pass; read by the crit rule. */
  elevation: number
  /** Terrain def id; see TerrainDef. */
  terrain: string
}

export interface Grid {
  width: number
  height: number
  /** Row-major, length width*height. Plain data for snapshot/replay. */
  tiles: Tile[]
}

// --- Abilities: the event -> effect grammar ----------------------------------
// The whole "units are data" bet lives here. A unit's behaviour beyond its raw
// stats is a list of abilities. An ability is a trigger (an event the engine
// emits), an optional condition, and a list of effects (data-described
// mutations). The engine never branches on a specific ability; it emits events
// and runs whatever effects the data hangs off them.

export type TriggerType =
  | 'on_kill'
  | 'on_move'
  | 'on_turn_start'
  | 'on_attack'
  | 'on_take_damage'
  | 'on_adjacent'
// To add a genuinely new *kind* of moment, extend this union AND emit the event
// from the relevant subsystem. That is the deliberate, bounded engine change.
// Individual abilities never require it — they only recombine existing triggers
// and effects in data.

// Effects and conditions are intentionally open records keyed by `type`. The
// executor resolves `type` through a handler registry, so authoring a new
// ability is pure data: no new union member, no new engine branch. `params`
// carries whatever a given handler needs.
export interface EffectDef {
  type: string
  [param: string]: unknown
}

export interface ConditionDef {
  type: string
  [param: string]: unknown
}

export interface AbilityDef {
  id: string
  name: string
  description?: string
  trigger: TriggerType
  condition?: ConditionDef
  effects: EffectDef[]
}

// --- Unit templates (content) vs unit instances (runtime) --------------------

export interface MovementProfile {
  /** Total movement points per activation. */
  points: number
  /**
   * Optional per-terrain cost overrides, keyed by terrain id. Absent entries
   * fall back to the terrain's own moveCost. This is the hook that lets a
   * future flier ignore forest/water without any engine change.
   */
  terrainCosts?: Record<string, number>
}

export interface AttackProfile {
  minRange: number
  maxRange: number
  /** Base accuracy before skill and terrain avoid are folded in. */
  hit: number
  /** Base crit chance before positional (elevation) bonuses. */
  crit: number
}

/** Immutable template loaded from JSON; instantiated into Units at battle start. */
export interface UnitDef {
  id: string
  name: string
  glyph: string
  faction: Faction
  stats: Stats
  movement: MovementProfile
  attack: AttackProfile
  /** Ability ids referencing the ability library. */
  abilities: string[]
}

/**
 * A live unit. Its name and ability list are mutable by design: evolution
 * rewrites them mid-battle, and over a campaign a unit drifts far from its
 * template. The engine treats all of this as data it reads, never as code.
 */
export interface Unit {
  id: string
  defId: string
  name: string
  faction: Faction
  glyph: string
  stats: Stats
  hp: number
  pos: Coord
  movement: MovementProfile
  attack: AttackProfile
  abilities: AbilityDef[]
  hasMoved: boolean
  hasActed: boolean
  alive: boolean
  kills: number
}

// --- Content bundle: immutable definitions loaded from data ------------------

export interface Content {
  terrain: Record<string, TerrainDef>
  abilities: Record<string, AbilityDef>
  units: Record<string, UnitDef>
}

// --- Battle state: the mutable world -----------------------------------------

export type Outcome = 'ongoing' | 'player_win' | 'enemy_win'

export interface BattleState {
  grid: Grid
  units: Unit[]
  turn: number
  /** Whose phase it currently is. */
  phase: Faction
  seed: number
  outcome: Outcome
}

// --- Events, logging, and the effect/condition seams -------------------------

export interface GameEvent {
  type: TriggerType
  /** The unit whose abilities may fire for this event. */
  unit: Unit
  /** Secondary participant, e.g. the slain unit for on_kill. */
  target?: Unit
  data?: Record<string, unknown>
}

/** Structured, human-narratable record of what happened, for UI and tests. */
export interface LogEntry {
  kind: string
  message: string
  data?: Record<string, unknown>
}

export type Logger = (entry: LogEntry) => void

/**
 * The context handed to every effect/condition handler. It bundles the world,
 * the immutable content (so effects can, e.g., draw from the ability pool),
 * the shared rng, and the logger. This is the only surface a handler touches —
 * new abilities compose against it rather than reaching into subsystems.
 */
export interface EffectContext {
  state: BattleState
  content: Content
  rng: Rng
  log: Logger
}

export type EffectHandler = (
  ctx: EffectContext,
  effect: EffectDef,
  event: GameEvent,
) => void

export type ConditionHandler = (
  ctx: EffectContext,
  condition: ConditionDef,
  event: GameEvent,
) => boolean
