import { describe, it, expect } from 'vitest'
import { makeRng } from '../src/engine/rng'
import {
  generateEncounters,
  killXp,
  DIFFICULTIES,
  ENEMY_STRENGTH,
} from '../src/run/encounters'
import { ALL_BIOMES } from '../src/run/biomes'
import { runContent } from '../src/run/content'

describe('run content variant', () => {
  it('elves evolve on level-up, not on kill; engine default is untouched', () => {
    expect(runContent.units.hana.abilities).toContain('evolve_on_level')
    expect(runContent.units.hana.abilities).not.toContain('evolve_on_kill')
    expect(runContent.abilities.evolve_on_level.trigger).toBe('on_level_up')
    // Same effects as the original evolution.
    expect(runContent.abilities.evolve_on_level.effects).toEqual(
      runContent.abilities.evolve_on_kill.effects,
    )
    // Enemies unchanged.
    expect(runContent.units.skeleton.abilities).toEqual([])
  })
})

describe('encounter generation', () => {
  it('is deterministic for a given RNG seed', () => {
    expect(generateEncounters(makeRng(2026))).toEqual(generateEncounters(makeRng(2026)))
  })

  it('produces the requested number of candidates with valid fields', () => {
    const encs = generateEncounters(makeRng(5), 3)
    expect(encs).toHaveLength(3)
    for (const e of encs) {
      expect(ALL_BIOMES).toContain(e.biome)
      expect(Object.keys(DIFFICULTIES)).toContain(e.difficulty)
      expect(e.enemyRoster.length).toBeGreaterThan(0)
      expect(e.xpReward).toBe(DIFFICULTIES[e.difficulty].xpReward)
    }
  })

  it('never overspends the difficulty strength budget', () => {
    for (const seed of [1, 2, 3, 4, 5, 99]) {
      for (const e of generateEncounters(makeRng(seed))) {
        const spent = e.enemyRoster.reduce((s, d) => s + ENEMY_STRENGTH[d], 0)
        expect(spent).toBeLessThanOrEqual(DIFFICULTIES[e.difficulty].budget)
      }
    }
  })

  it('kill XP scales with victim strength and difficulty', () => {
    expect(killXp('skeleton', 'skirmish')).toBe(35)
    expect(killXp('wight', 'skirmish')).toBe(105)
    expect(killXp('skeleton', 'horde')).toBe(Math.round(35 * 1.5))
  })
})
