// The run: a sequence of battles with persistent, evolving units, sitting
// entirely above the battle engine. It drives Battle only through the public
// API and observes it only through the event bus — the engine never learns what
// a run, XP, or an encounter is.
//
// Determinism model (matching the engine): a run is fixed by its seed plus the
// ordered list of encounter picks. Two runs with the same seed and choices
// unfold identically. Two independent RNG streams — one for encounter
// generation, one for evolution rolls — are both derived from the run seed, so
// adding an evolution draw never shifts which encounters appear.

import { Battle } from '../engine/battle'
import { makeRng, type Rng } from '../engine/rng'
import { makeAbilitySystem, type AbilitySystem } from '../engine/abilities'
import { instantiateUnit } from '../engine/content'
import type { EffectContext, GameEvent, LogEntry, Unit } from '../engine/types'
import { runContent } from './content'
import { BIOMES } from './biomes'
import { generateEncounters, killXp, type Encounter } from './encounters'
import { grantXp } from './progression'
import { NameRegistry } from './names'
import { enduredFocus, recoveredHp } from './promotion'

export type RunPhase = 'roster' | 'deploy' | 'battle' | 'won' | 'lost'

export interface RosterEntry {
  unit: Unit
  xp: number
  level: number
}

export interface RunConfig {
  seed: number
  battles?: number
  /** Max units deployable per battle. The roster is larger, so this is a choice. */
  fieldCap?: number
  /** Unit defIds seeding the roster (default the six named elves). */
  roster?: string[]
}

// Roster deliberately exceeds the field cap: that gap is the whole point of the
// deployment decision. Both are tunable via RunConfig.
const DEFAULT_ROSTER = ['sakura', 'hana', 'yuki', 'aoi', 'kaede', 'mei']
const DEFAULT_FIELD_CAP = 4
const DEFAULT_BATTLES = 4

export class Run {
  readonly seed: number
  readonly totalBattles: number
  readonly fieldCap: number
  readonly log: LogEntry[] = []

  roster: RosterEntry[]
  fallen: RosterEntry[] = []
  encounters: Encounter[]
  phase: RunPhase = 'roster'
  battleIndex = 0

  /** The encounter chosen on the roster screen, awaiting a deployment pick. */
  pendingEncounter: Encounter | null = null
  /**
   * Per completed battle, the deployed unit ids in canonical order. Part of the
   * recorded run state: a run replays identically only if the same units were
   * deployed each battle.
   */
  deploymentHistory: string[][] = []

  // Two independent deterministic streams derived from the run seed.
  private readonly encounterRng: Rng
  private readonly progressionRng: Rng
  private readonly abilities: AbilitySystem = makeAbilitySystem()
  // Per-run name draw for levy→named promotion. Seeded from the run seed; its
  // pools are shuffled once at construction, independently of the two RNG
  // streams above (a separate stream), so wiring it in never perturbs encounter
  // generation or evolution rolls — existing replays stay byte-identical.
  private readonly names: NameRegistry

  // Transient state while a battle is in progress.
  private battle: Battle | null = null
  private encounter: Encounter | null = null
  private deployed: RosterEntry[] | null = null
  private unsub: (() => void) | null = null
  // Each deployed unit's HP at the moment the battle began, by id. The promotion
  // crossing check needs the START HP (which, post-wound, may be below max), not
  // the end-of-battle HP the unit objects carry by resolution time.
  private battleStartHp: Map<string, number> | null = null

  constructor(config: RunConfig) {
    this.seed = config.seed
    this.totalBattles = config.battles ?? DEFAULT_BATTLES
    this.fieldCap = config.fieldCap ?? DEFAULT_FIELD_CAP
    this.encounterRng = makeRng(config.seed)
    this.progressionRng = makeRng((config.seed ^ 0x9e3779b9) >>> 0)
    this.names = new NameRegistry(config.seed)

    const defs = config.roster ?? DEFAULT_ROSTER
    this.roster = defs.map((defId, i) => ({
      unit: instantiateUnit(runContent, defId, `${defId}#${i}`),
      xp: 0,
      level: 1,
    }))
    this.encounters = generateEncounters(this.encounterRng)
    this.log.push({ kind: 'run', message: 'The Deepwood musters its defenders.' })
  }

  get currentBattle(): Battle | null {
    return this.battle
  }

  /** Most units that may be fielded at once (cap, or the whole roster if smaller). */
  maxDeployable(): number {
    return Math.min(this.fieldCap, this.roster.length)
  }

  /** Pick a candidate encounter; advances to the deployment screen (no battle yet). */
  chooseEncounter(index: number): void {
    if (this.phase !== 'roster') throw new Error('chooseEncounter() only valid on the roster screen')
    const encounter = this.encounters[index]
    if (!encounter) throw new Error(`no encounter at index ${index}`)
    this.pendingEncounter = encounter
    this.phase = 'deploy'
  }

  /** Back out of deployment to re-pick the encounter. Records nothing. */
  cancelDeploy(): void {
    if (this.phase !== 'deploy') throw new Error('cancelDeploy() only valid on the deployment screen')
    this.pendingEncounter = null
    this.phase = 'roster'
  }

  /**
   * Field the chosen subset (by roster unit id) and start the battle. The
   * battle receives ONLY these units; benched units sit out — they earn no XP
   * and take no damage. Recovery is uniform (deployed and benched alike knit HP
   * back each encounter, in finishBattle), so fielding a wounded unit is a pure
   * risk-vs-reward call: it recovers either way, but only the fielded can be hurt.
   */
  deploy(entryIds: string[]): Battle {
    if (this.phase !== 'deploy' || !this.pendingEncounter) {
      throw new Error('deploy() only valid on the deployment screen')
    }
    const encounter = this.pendingEncounter
    const ids = new Set(entryIds)
    const cap = this.maxDeployable()
    if (ids.size < 1 || ids.size > cap) {
      throw new Error(`deploy: must field between 1 and ${cap} units`)
    }
    // Canonical order (roster order), independent of click order, so the same
    // subset always produces the same battle — required for deterministic replay.
    const deployed = this.roster.filter((e) => ids.has(e.unit.id))
    if (deployed.length !== ids.size) throw new Error('deploy: unknown unit id in selection')

    // No heal-to-full: units carry their current (possibly wounded) HP into the
    // fight — recovery happens gradually between encounters (see finishBattle).
    // Record each unit's starting HP so the promotion crossing check can tell a
    // fresh wound from one the unit walked in with.
    this.battleStartHp = new Map(deployed.map((e) => [e.unit.id, e.unit.hp]))

    const battle = new Battle({
      seed: encounter.seed,
      content: runContent,
      mapConfig: BIOMES[encounter.biome].mapConfig,
      enemyRoster: encounter.enemyRoster,
      playerUnits: deployed.map((e) => e.unit),
    })

    // Live kill-XP: award to the killer as kills happen, and evolve mid-fight if
    // a threshold is crossed. Evolution logs into the battle chronicle.
    const ctx = this.ctxFor(battle, (e) => battle.log.push(e))
    this.unsub = battle.onEvent((event) => {
      if (event.type === 'on_kill') this.onKill(event, encounter, ctx, battle.log)
    })

    this.battle = battle
    this.encounter = encounter
    this.deployed = deployed
    this.deploymentHistory.push(deployed.map((e) => e.unit.id))
    this.pendingEncounter = null
    this.phase = 'battle'
    this.log.push({
      kind: 'run',
      message: `Encounter ${this.battleIndex + 1}/${this.totalBattles}: ${BIOMES[encounter.biome].label}, ${encounter.difficulty}. Fielding ${deployed.map((e) => e.unit.name).join(', ')}.`,
    })
    return battle
  }

  /**
   * Resolve the finished battle: grant clear-XP to survivors, retire the dead,
   * advance the run, and generate the next candidates (or end the run).
   */
  finishBattle(): void {
    if (this.phase !== 'battle' || !this.battle || !this.encounter || !this.deployed) {
      throw new Error('finishBattle() with no battle in progress')
    }
    const battle = this.battle
    const encounter = this.encounter
    const deployed = this.deployed
    this.unsub?.()

    if (battle.outcome === 'player_win') {
      // Clear-XP to surviving DEPLOYED units only. Benched units earn nothing
      // from a battle they sat out — the opportunity cost of the bench.
      const ctx = this.ctxFor(battle, (e) => this.log.push(e))
      for (const entry of deployed) {
        if (!entry.unit.alive) continue
        grantXp(entry, encounter.xpReward, (lvl) => this.evolve(entry, ctx, this.log, lvl))
      }
      this.log.push({ kind: 'result', message: 'Encounter cleared.' })
    } else if (battle.outcome === 'ongoing') {
      // A stalemate (forces isolated, no clear victor): no reward, but the dead
      // are still counted below and the run moves on.
      this.log.push({ kind: 'result', message: 'The battle bogged down. No ground was gained.' })
    }

    // Identity genesis: a deployed levy whose HP crossed DOWN through the
    // promotion threshold this battle (entered at/above it, was driven below,
    // survived) earns a name and graduates to `named`. Passing startHp is what
    // stops a unit that walked in already wounded from auto-promoting on mere
    // survival. Evaluated in canonical roster order (deployed is a roster-order
    // filter), so name draws happen in a replay-stable sequence. Benched units
    // aren't in `deployed`; dead units fail the `alive` check — neither can
    // promote. Outcome is irrelevant: a survivor of a stalemate can still cross.
    for (const entry of deployed) {
      const startHp = this.battleStartHp?.get(entry.unit.id) ?? entry.unit.hp
      if (entry.unit.alive && entry.unit.tier === 'levy' && enduredFocus(entry.unit, battle.log, startHp)) {
        this.promote(entry)
      }
    }

    // Persistent permadeath: only deployed units could have died; the dead leave
    // the roster for the rest of the run. Benched units carry forward untouched.
    for (const entry of this.roster) {
      if (!entry.unit.alive) {
        this.fallen.push(entry)
        this.log.push({ kind: 'fallen', message: `${entry.unit.name} has fallen. She will not return.` })
      }
    }
    this.roster = this.roster.filter((e) => e.unit.alive)

    // Gradual recovery replaces heal-to-full. Every surviving roster unit —
    // whether it fought or sat out — knits a fixed step of max HP back this
    // encounter. Deterministic and HP-only: maxHp is never touched, no PRNG is
    // involved, and the dead (already removed above) never recover.
    for (const entry of this.roster) {
      entry.unit.hp = recoveredHp(entry.unit.hp, entry.unit.stats.maxHp)
    }

    this.battleIndex += 1
    this.battle = null
    this.encounter = null
    this.deployed = null
    this.battleStartHp = null

    // The run ends only when the whole roster is dead (a battle can be lost with
    // benched survivors and the run continues) or all battles are behind us.
    if (this.roster.length === 0) {
      this.phase = 'lost'
      this.log.push({ kind: 'result', message: 'The Deepwood has no defenders left. The forest goes dark.' })
    } else if (this.battleIndex >= this.totalBattles) {
      this.phase = 'won'
      this.log.push({ kind: 'result', message: 'The horde is spent. The Deepwood endures.' })
    } else {
      this.encounters = generateEncounters(this.encounterRng)
      this.phase = 'roster'
    }
  }

  // --- internals -------------------------------------------------------------

  private ctxFor(battle: Battle, log: (e: LogEntry) => void): EffectContext {
    return { state: battle.state, content: runContent, rng: this.progressionRng, log }
  }

  private onKill(event: GameEvent, encounter: Encounter, ctx: EffectContext, log: LogEntry[]): void {
    const entry = this.roster.find((e) => e.unit === event.unit)
    if (!entry || !event.target) return // only named units in the roster earn XP
    const amount = killXp(event.target.defId, encounter.difficulty)
    log.push({ kind: 'xp', message: `${entry.unit.name} earns ${amount} XP.` })
    grantXp(entry, amount, (lvl) => this.evolve(entry, ctx, log, lvl))
  }

  // Fire one evolution: announce the level, then dispatch on_level_up through
  // the run's OWN ability system (not the battle's bus), so the grant+rename
  // effects run without the battle engine ever seeing a run concept.
  private evolve(entry: RosterEntry, ctx: EffectContext, log: LogEntry[], newLevel: number): void {
    log.push({ kind: 'levelup', message: `${entry.unit.name} reaches level ${newLevel}!` })
    this.abilities.dispatch(ctx, { type: 'on_level_up', unit: entry.unit })
  }

  // Mint a protagonist: draw a persistent name from the unit's culture pool and
  // graduate the tier. Name-only — no stats, no abilities, no mechanical change.
  private promote(entry: RosterEntry): void {
    const former = entry.unit.name
    // Resolve the pool from the unit's (species, gender). Units don't carry
    // those attributes yet, so pass the constant (elf, female); switch to
    // unit.species / unit.gender here once units carry them.
    const name = this.names.draw('elf', 'female', entry.unit.id)
    entry.unit.name = name
    entry.unit.tier = 'named'
    this.log.push({
      kind: 'promotion',
      message: `A levy held the line under focused fire and earns a name: ${name} (was ${former}).`,
    })
  }

  /** A plain, JSON-serialisable snapshot (units carry ability ids). Handy for
   *  save/debug; note that resume-from-snapshot is not wired this session —
   *  determinism is guaranteed by replaying seed + the same encounter picks. */
  snapshot() {
    const entry = (e: RosterEntry) => ({
      defId: e.unit.defId,
      name: e.unit.name,
      tier: e.unit.tier,
      xp: e.xp,
      level: e.level,
      hp: e.unit.hp,
      stats: { ...e.unit.stats },
      abilities: e.unit.abilities.map((a) => a.id),
      kills: e.unit.kills,
    })
    return {
      seed: this.seed,
      totalBattles: this.totalBattles,
      fieldCap: this.fieldCap,
      battleIndex: this.battleIndex,
      phase: this.phase,
      roster: this.roster.map(entry),
      fallen: this.fallen.map(entry),
      encounters: this.encounters,
      // Deployment picks are part of the replayable run state.
      deploymentHistory: this.deploymentHistory,
    }
  }
}
