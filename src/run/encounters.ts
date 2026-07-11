// Encounter generation. Between battles the run offers three candidates; the
// pick is the whole decision. An encounter is pure data — difficulty, biome, an
// enemy roster, an XP reward, and a battle seed — that seeds the next Battle.
// Generation is deterministic: same run RNG => same candidates.

import type { Rng } from '../engine/rng'
import { ALL_BIOMES, type Biome } from './biomes'

export type Difficulty = 'skirmish' | 'raid' | 'horde'

export interface DifficultyDef {
  label: string
  /** Total enemy "strength points" to field. */
  budget: number
  /** Flat clear-XP granted to each surviving named unit on victory. */
  xpReward: number
  /** Multiplier on kill-XP earned during the fight. */
  killXpMult: number
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  skirmish: { label: 'Skirmish', budget: 6, xpReward: 40, killXpMult: 1.0 },
  raid: { label: 'Raid', budget: 9, xpReward: 70, killXpMult: 1.25 },
  horde: { label: 'Horde', budget: 13, xpReward: 110, killXpMult: 1.5 },
}

const DIFFICULTY_ORDER: Difficulty[] = ['skirmish', 'raid', 'horde']

// Enemy templates and their strength cost. Strength doubles as the base for the
// XP a kill is worth, so tougher foes are worth more.
export const ENEMY_STRENGTH: Record<string, number> = {
  skeleton: 1,
  ghoul: 2,
  wight: 3,
}

// Weighted draw bag: skeletons common, wights rare.
const ENEMY_BAG: string[] = ['skeleton', 'skeleton', 'skeleton', 'ghoul', 'ghoul', 'wight']

export interface Encounter {
  id: string
  difficulty: Difficulty
  biome: Biome
  /** Enemy unit def ids to field. */
  enemyRoster: string[]
  /** Clear-XP per surviving named unit on victory. */
  xpReward: number
  /** Seeds the Battle's map and combat RNG. */
  seed: number
}

// Base kill-XP per point of enemy strength, before the difficulty multiplier.
export const KILL_XP_PER_STRENGTH = 35

/** XP a unit earns for killing `victimDefId` in an encounter of `difficulty`. */
export function killXp(victimDefId: string, difficulty: Difficulty): number {
  const strength = ENEMY_STRENGTH[victimDefId] ?? 1
  return Math.round(strength * KILL_XP_PER_STRENGTH * DIFFICULTIES[difficulty].killXpMult)
}

// Fill a strength budget with weighted random enemies, never overspending.
function rollEnemyRoster(rng: Rng, budget: number): string[] {
  const roster: string[] = []
  let remaining = budget
  // Guard against pathological loops: the cheapest enemy costs 1, so budget
  // iterations is a hard ceiling.
  for (let guard = 0; guard < budget + 1 && remaining > 0; guard++) {
    const affordable = ENEMY_BAG.filter((d) => ENEMY_STRENGTH[d] <= remaining)
    if (affordable.length === 0) break
    const pick = rng.pick(affordable)
    roster.push(pick)
    remaining -= ENEMY_STRENGTH[pick]
  }
  return roster
}

/** Generate `count` fresh candidate encounters from the run RNG. */
export function generateEncounters(rng: Rng, count = 3): Encounter[] {
  const out: Encounter[] = []
  for (let i = 0; i < count; i++) {
    const difficulty = rng.pick(DIFFICULTY_ORDER)
    const biome = rng.pick(ALL_BIOMES) as Biome
    const seed = rng.int(1, 2 ** 30)
    const def = DIFFICULTIES[difficulty]
    out.push({
      id: `enc-${seed}`,
      difficulty,
      biome,
      enemyRoster: rollEnemyRoster(rng, def.budget),
      xpReward: def.xpReward,
      seed,
    })
  }
  return out
}
