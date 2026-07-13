// Battle orchestration: the one place the subsystems meet. It owns the turn/
// phase loop, validates and applies commands (move, attack, wait, end phase),
// routes GameEvents through the bus to the ability system, narrates to a log,
// and decides win/loss. Movement, combat, and abilities remain mutually
// ignorant — battle is the integrator, not a god object that reimplements them.
//
// The whole thing is headless and deterministic: construct with a seed, feed a
// sequence of commands, and the outcome is fixed. The UI is just one possible
// driver of this API; tests and mass simulation are others.

import { generateMap, DEFAULT_MAPGEN, type MapGenConfig } from './mapgen'
import { defaultContent, instantiateUnit } from './content'
import { makeEventBus, type EventBus, type EventHandler } from './events'
import { makeRng, type Rng } from './rng'
import { makeAbilitySystem, type AbilitySystem } from './abilities'
import { reachable, moveDestinations, canStopAt, type Reach } from './movement'
import { coordsEqual } from './grid'
import { resolveCombat, inAttackRange, forecast, type CombatResult, type Forecast } from './combat'
import { classifyAction, type ActionKind } from './commitment'
import type {
  BattleState,
  Content,
  Coord,
  EffectContext,
  Faction,
  GameEvent,
  LogEntry,
  Unit,
} from './types'

export interface BattleOptions {
  seed: number
  content?: Content
  mapConfig?: MapGenConfig
  /** Unit def ids to field for each side; defaults to the prototype's roster. */
  playerRoster?: string[]
  enemyRoster?: string[]
  /**
   * Pre-built player units to deploy instead of instantiating from
   * playerRoster. Run-agnostic: it lets a caller carry persistent units across
   * battles. Their on_gain passives are assumed already applied (the battle
   * won't re-apply them), and their positions are reassigned on deployment.
   */
  playerUnits?: Unit[]
}

const DEFAULT_PLAYER_ROSTER = ['sakura', 'hana', 'yuki', 'aoi']
const DEFAULT_ENEMY_ROSTER = ['skeleton', 'skeleton', 'skeleton', 'ghoul', 'ghoul', 'wight']

/** The exact turn-state a reversible action can be rewound to (see undo). */
interface TurnStateSnapshot {
  pos: Coord
  movementRemaining: number
  attacksRemaining: number
}

/**
 * An open intra-unit undo activation: the continuous span during which a driver
 * commands ONE unit. `stack` holds pre-action snapshots of the reversible moves
 * taken since the activation opened (or since the unit's last COMMITTING action).
 * Purely authoring-time bookkeeping — it lives on the Battle, never in
 * `BattleState`, is never logged, and stays `null` for the AI/run drivers (which
 * never open an activation), so replays are untouched.
 */
interface Activation {
  unitId: string
  stack: TurnStateSnapshot[]
}

export class Battle {
  readonly content: Content
  readonly state: BattleState
  readonly log: LogEntry[] = []

  private readonly rng: Rng
  private readonly bus: EventBus
  private readonly abilities: AbilitySystem
  private readonly ctx: EffectContext
  // Open intra-unit undo activation, or null. Only interactive drivers open one.
  private activation: Activation | null = null

  constructor(opts: BattleOptions) {
    this.content = opts.content ?? defaultContent
    this.rng = makeRng(opts.seed)
    this.bus = makeEventBus()
    this.abilities = makeAbilitySystem()

    const grid = generateMap(opts.seed, opts.mapConfig ?? DEFAULT_MAPGEN)
    const { units, injected } = this.deploy(grid, opts)
    this.state = { grid, units, turn: 1, phase: 'player', seed: opts.seed, outcome: 'ongoing' }

    // Stable context object handed to every ability handler.
    this.ctx = {
      state: this.state,
      content: this.content,
      rng: this.rng,
      log: (e) => this.log.push(e),
    }
    // The ability system is the bus's primary subscriber. Anyone else (the UI)
    // may subscribe too, for narration or animation.
    this.bus.on((event) => this.abilities.dispatch(this.ctx, event))

    // Apply starting on_gain passives — but NOT for injected units, whose
    // passives were already applied when they were first built; re-applying
    // would stack them every battle.
    for (const u of units)
      if (!injected.has(u.id)) for (const a of u.abilities) this.abilities.applyOnGain(this.ctx, u, a)
    this.beginPhase('player')
  }

  // --- deployment ------------------------------------------------------------

  private deploy(
    grid: BattleState['grid'],
    opts: BattleOptions,
  ): { units: Unit[]; injected: Set<string> } {
    const taken = new Set<string>()
    const units: Unit[] = []
    const counters: Record<string, number> = {}

    const nextId = (defId: string): string => {
      counters[defId] = (counters[defId] ?? 0) + 1
      return `${defId}#${counters[defId]}`
    }

    // Assign board positions to already-built units, hugging one edge.
    const position = (list: Unit[], fromLeft: boolean): void => {
      const cols = fromLeft
        ? [...Array(grid.width).keys()]
        : [...Array(grid.width).keys()].reverse()
      let placed = 0
      for (const x of cols) {
        if (placed >= list.length) break
        for (const y of centerOut(grid.height)) {
          if (placed >= list.length) break
          const terrain = this.content.terrain[grid.tiles[y * grid.width + x].terrain]
          const k = `${x},${y}`
          if (!terrain.passable || taken.has(k)) continue
          list[placed].pos = { x, y }
          taken.add(k)
          units.push(list[placed])
          placed++
        }
      }
      if (placed < list.length) throw new Error('deploy: not enough passable tiles for the roster')
    }

    const injected = new Set<string>()
    if (opts.playerUnits) {
      position(opts.playerUnits, true)
      for (const u of opts.playerUnits) injected.add(u.id)
    } else {
      const defs = opts.playerRoster ?? DEFAULT_PLAYER_ROSTER
      position(defs.map((d) => instantiateUnit(this.content, d, nextId(d))), true)
    }

    const enemyDefs = opts.enemyRoster ?? DEFAULT_ENEMY_ROSTER
    position(enemyDefs.map((d) => instantiateUnit(this.content, d, nextId(d))), false)

    return { units, injected }
  }

  // --- queries (read-only helpers for a driver) ------------------------------

  unitById(id: string): Unit | undefined {
    return this.state.units.find((u) => u.id === id)
  }

  living(faction?: Faction): Unit[] {
    return this.state.units.filter((u) => u.alive && (faction === undefined || u.faction === faction))
  }

  reachable(unit: Unit): Reach {
    return reachable(this.state, this.content, unit)
  }

  /** Legal stopping tiles given the unit's REMAINING movement budget. */
  destinations(unit: Unit): Coord[] {
    if (unit.spent) return []
    return moveDestinations(this.reachable(unit), this.state, unit)
  }

  /** Enemies attackable from the unit's current tile, if it has an attack left. */
  attackTargets(unit: Unit): Unit[] {
    if (unit.spent || unit.attacksRemaining <= 0) return []
    return this.living().filter((t) => t.faction !== unit.faction && inAttackRange(unit, t))
  }

  forecast(attacker: Unit, defender: Unit): Forecast {
    return forecast(this.state, this.content, attacker, defender)
  }

  get outcome() {
    return this.state.outcome
  }

  onEvent(handler: EventHandler): () => void {
    return this.bus.on(handler)
  }

  // --- commands --------------------------------------------------------------

  /**
   * Move a unit to a legal destination, spending its path cost from
   * movementRemaining. Returns false (no-op) if illegal. A unit may move more
   * than once per activation while budget remains, and may move after attacking.
   */
  moveUnit(unitId: string, dest: Coord): boolean {
    const u = this.actableUnit(unitId)
    if (!u || u.spent) return false
    if (coordsEqual(u.pos, dest)) return false // staying put isn't a move
    const reach = reachable(this.state, this.content, u)
    const cost = reach.costs.get(`${dest.x},${dest.y}`)
    if (cost === undefined || !canStopAt(this.state, u, dest.x, dest.y)) return false
    const before = this.captureTurnState(u) // for undo, taken before mutating
    u.pos = { ...dest }
    u.movementRemaining -= cost
    this.emit({ type: 'on_move', unit: u })
    this.recordAction(unitId, 'move', before)
    return true
  }

  /** Resolve an attack; returns the combat record, or null if illegal. */
  attack(attackerId: string, defenderId: string): CombatResult | null {
    const attacker = this.actableUnit(attackerId)
    const defender = this.unitById(defenderId)
    if (!attacker || attacker.spent || attacker.attacksRemaining <= 0) return null
    if (!defender || !defender.alive || defender.faction === attacker.faction) return null
    if (!inAttackRange(attacker, defender)) return null

    const before = this.captureTurnState(attacker) // uniform routing; unused for a committing action
    const result = resolveCombat(this.state, this.content, this.rng, attacker, defender)
    // Spend one attack. Free ordering: movement is NOT consumed and the unit is
    // NOT ended — it may still move (move-shoot-move) while movementRemaining lasts.
    attacker.attacksRemaining -= 1
    // Attack is COMMITTING (resolves RNG): this floors the undo stack so nothing
    // at/before this attack is ever undoable.
    this.recordAction(attackerId, 'attack', before)

    this.narrateCombat(result)
    // Fire on_kill for every death, crediting the killer — this is where
    // evolution happens, entirely via the ability grammar.
    for (const death of result.deaths) {
      const killer = this.unitById(death.killerId)
      const victim = this.unitById(death.victimId)
      if (killer && victim) this.emit({ type: 'on_kill', unit: killer, target: victim })
    }
    this.checkOutcome()
    return result
  }

  /** End a unit's activation: it takes no further actions this phase. */
  waitUnit(unitId: string): boolean {
    const u = this.actableUnit(unitId)
    if (!u) return false
    u.spent = true
    u.movementRemaining = 0
    u.attacksRemaining = 0
    if (this.activation?.unitId === unitId) this.activation = null // Wait closes the undo activation
    return true
  }

  // --- intra-unit undo -------------------------------------------------------
  // An "activation" is one continuous span of commanding a single unit. Only an
  // interactive driver opens one; the AI/run never do, so this whole subsystem is
  // inert (and replay-neutral) unless a human is at the controls.

  /**
   * Open (or keep) an undo activation for `unitId`. Idempotent for the same unit
   * — re-selecting it mid-activation preserves the stack. Selecting a DIFFERENT
   * unit starts a fresh activation, discarding the previous unit's stack (undo
   * never crosses unit selections).
   */
  beginActivation(unitId: string): void {
    if (this.activation?.unitId === unitId) return
    this.activation = { unitId, stack: [] }
  }

  /** Close the current activation (deselect / switch away). Clears the stack. */
  endActivation(): void {
    this.activation = null
  }

  /** Is there a reversible action to undo in the current activation? */
  canUndo(): boolean {
    return this.activation !== null && this.activation.stack.length > 0
  }

  /**
   * Rewind the most recent reversible action of the current activation, restoring
   * exact prior turn-state (position, movementRemaining, attacksRemaining).
   * Consumes NO randomness and emits nothing. No-op (returns false) on an empty
   * stack or closed activation. Undo can never reach past a COMMITTING action,
   * because such actions clear the stack (see recordAction).
   */
  undo(): boolean {
    if (!this.activation || this.activation.stack.length === 0) return false
    const snap = this.activation.stack.pop()!
    const u = this.unitById(this.activation.unitId)
    if (!u) return false
    u.pos = { ...snap.pos }
    u.movementRemaining = snap.movementRemaining
    u.attacksRemaining = snap.attacksRemaining
    return true
  }

  /** End the current side's phase and open the other's. */
  endPhase(): void {
    if (this.state.outcome !== 'ongoing') return
    const next: Faction = this.state.phase === 'player' ? 'enemy' : 'player'
    this.state.phase = next
    if (next === 'player') this.state.turn += 1
    this.beginPhase(next)
  }

  // --- internals -------------------------------------------------------------

  private captureTurnState(u: Unit): TurnStateSnapshot {
    return { pos: { ...u.pos }, movementRemaining: u.movementRemaining, attacksRemaining: u.attacksRemaining }
  }

  // The single place every action is routed through the commitment policy. If the
  // unit is the one being activated: a REVERSIBLE action pushes its pre-state for
  // undo; a COMMITTING action floors the stack (nothing at/before it is undoable).
  private recordAction(unitId: string, kind: ActionKind, before: TurnStateSnapshot): void {
    if (this.activation?.unitId !== unitId) return
    if (classifyAction(kind) === 'committing') this.activation.stack = []
    else this.activation.stack.push(before)
  }

  private actableUnit(id: string): Unit | undefined {
    if (this.state.outcome !== 'ongoing') return undefined
    const u = this.unitById(id)
    if (!u || !u.alive || u.faction !== this.state.phase) return undefined
    return u
  }

  private beginPhase(faction: Faction): void {
    this.activation = null // phase end closes any open undo activation
    const roster = this.living(faction)
    for (const u of roster) {
      // Refill the per-activation budgets and clear the done flag.
      u.movementRemaining = u.movement.points
      u.attacksRemaining = u.attackBudget
      u.spent = false
    }
    this.log.push({ kind: 'phase', message: `— ${faction} phase (turn ${this.state.turn}) —` })
    // Turn-start triggers fire after flags reset (e.g. Forest Ward regen).
    for (const u of roster) this.emit({ type: 'on_turn_start', unit: u })
  }

  private emit(event: GameEvent): void {
    this.bus.emit(event)
  }

  private narrateCombat(result: CombatResult): void {
    for (const b of result.blows) {
      const s = this.unitById(b.strikerId)?.name ?? b.strikerId
      const t = this.unitById(b.targetId)?.name ?? b.targetId
      if (!b.hit) {
        this.log.push({ kind: 'combat', message: `${s} attacks ${t} — miss.` })
      } else {
        this.log.push({
          kind: 'combat',
          message: `${s} hits ${t} for ${b.damage}${b.crit ? ' (crit!)' : ''}${b.killed ? ' — ' + t + ' falls!' : ''}.`,
          data: { ...b },
        })
      }
    }
  }

  private checkOutcome(): void {
    if (this.living('enemy').length === 0) {
      this.state.outcome = 'player_win'
      this.log.push({ kind: 'result', message: 'The undead are broken. The Deepwood holds.' })
    } else if (this.living('player').length === 0) {
      this.state.outcome = 'enemy_win'
      this.log.push({ kind: 'result', message: 'The last elf falls. The forest goes dark.' })
    }
  }
}

/** Center-out ordering of row indices, for deployment that hugs the vertical middle. */
function centerOut(height: number): number[] {
  const mid = Math.floor(height / 2)
  const order: number[] = [mid]
  for (let d = 1; d <= height; d++) {
    if (mid - d >= 0) order.push(mid - d)
    if (mid + d < height) order.push(mid + d)
  }
  return order
}
