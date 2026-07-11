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

export type RunPhase = 'roster' | 'battle' | 'won' | 'lost'

export interface RosterEntry {
  unit: Unit
  xp: number
  level: number
}

export interface RunConfig {
  seed: number
  battles?: number
}

const NAMED_ELVES = ['sakura', 'hana', 'yuki', 'aoi']
const DEFAULT_BATTLES = 4

export class Run {
  readonly seed: number
  readonly totalBattles: number
  readonly log: LogEntry[] = []

  roster: RosterEntry[]
  fallen: RosterEntry[] = []
  encounters: Encounter[]
  phase: RunPhase = 'roster'
  battleIndex = 0

  // Two independent deterministic streams derived from the run seed.
  private readonly encounterRng: Rng
  private readonly progressionRng: Rng
  private readonly abilities: AbilitySystem = makeAbilitySystem()

  // Transient state while a battle is in progress.
  private battle: Battle | null = null
  private encounter: Encounter | null = null
  private unsub: (() => void) | null = null

  constructor(config: RunConfig) {
    this.seed = config.seed
    this.totalBattles = config.battles ?? DEFAULT_BATTLES
    this.encounterRng = makeRng(config.seed)
    this.progressionRng = makeRng((config.seed ^ 0x9e3779b9) >>> 0)

    this.roster = NAMED_ELVES.map((defId, i) => ({
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

  /** Pick one of the current candidate encounters and start its battle. */
  choose(index: number): Battle {
    if (this.phase !== 'roster') throw new Error('choose() only valid on the roster screen')
    const encounter = this.encounters[index]
    if (!encounter) throw new Error(`no encounter at index ${index}`)

    // Heal survivors to full (no healing economy yet) and field the persistent
    // unit objects directly, so evolutions/stats carry forward untouched.
    for (const e of this.roster) {
      e.unit.hp = e.unit.stats.maxHp
      e.unit.alive = true
    }

    const battle = new Battle({
      seed: encounter.seed,
      content: runContent,
      mapConfig: BIOMES[encounter.biome].mapConfig,
      enemyRoster: encounter.enemyRoster,
      playerUnits: this.roster.map((e) => e.unit),
    })

    // Live kill-XP: award to the killer as kills happen, and evolve mid-fight if
    // a threshold is crossed. Evolution logs into the battle chronicle.
    const ctx = this.ctxFor(battle, (e) => battle.log.push(e))
    this.unsub = battle.onEvent((event) => {
      if (event.type === 'on_kill') this.onKill(event, encounter, ctx, battle.log)
    })

    this.battle = battle
    this.encounter = encounter
    this.phase = 'battle'
    this.log.push({
      kind: 'run',
      message: `Encounter ${this.battleIndex + 1}/${this.totalBattles}: ${BIOMES[encounter.biome].label}, ${encounter.difficulty}.`,
    })
    return battle
  }

  /**
   * Resolve the finished battle: grant clear-XP to survivors, retire the dead,
   * advance the run, and generate the next candidates (or end the run).
   */
  finishBattle(): void {
    if (this.phase !== 'battle' || !this.battle || !this.encounter) {
      throw new Error('finishBattle() with no battle in progress')
    }
    const battle = this.battle
    const encounter = this.encounter
    if (battle.outcome === 'ongoing') throw new Error('finishBattle() before the battle concluded')
    this.unsub?.()

    if (battle.outcome === 'player_win') {
      // Clear-XP to each surviving named unit; any level-ups evolve now (on the
      // roster screen), logged into the run chronicle.
      const ctx = this.ctxFor(battle, (e) => this.log.push(e))
      for (const entry of this.roster) {
        if (!entry.unit.alive) continue
        grantXp(entry, encounter.xpReward, (lvl) => this.evolve(entry, ctx, this.log, lvl))
      }
      this.log.push({ kind: 'result', message: 'Encounter cleared.' })
    }

    // Persistent permadeath: the dead leave the roster for the rest of the run.
    for (const entry of this.roster) {
      if (!entry.unit.alive) {
        this.fallen.push(entry)
        this.log.push({ kind: 'fallen', message: `${entry.unit.name} has fallen. She will not return.` })
      }
    }
    this.roster = this.roster.filter((e) => e.unit.alive)
    this.battleIndex += 1
    this.battle = null
    this.encounter = null

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

  /** A plain, JSON-serialisable snapshot (units carry ability ids). Handy for
   *  save/debug; note that resume-from-snapshot is not wired this session —
   *  determinism is guaranteed by replaying seed + the same encounter picks. */
  snapshot() {
    const entry = (e: RosterEntry) => ({
      defId: e.unit.defId,
      name: e.unit.name,
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
      battleIndex: this.battleIndex,
      phase: this.phase,
      roster: this.roster.map(entry),
      fallen: this.fallen.map(entry),
      encounters: this.encounters,
    }
  }
}
