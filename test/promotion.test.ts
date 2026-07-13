import { describe, it, expect } from 'vitest'
import { Run } from '../src/run/run'
import { NameRegistry } from '../src/run/names'
import {
  enduredFocus,
  lowestHpReached,
  recoveredHp,
  PROMOTION_HP_FRACTION,
  RECOVERY_FRACTION,
} from '../src/run/promotion'
import { instantiateUnit } from '../src/engine/content'
import { runContent } from '../src/run/content'
import { autoPlay } from '../src/engine/ai'
import { deployHTML } from '../src/ui/run-render'
import type { LogEntry } from '../src/engine/types'

// --- name pools: the deterministic draw contract ---------------------------

describe('NameRegistry — deterministic culture-pool draws', () => {
  it('same run seed reproduces the same draw sequence', () => {
    const draws = (seed: number) => {
      const r = new NameRegistry(seed)
      return Array.from({ length: 5 }, (_, i) => r.draw('elf', 'female', `u${i}`))
    }
    expect(draws(777)).toEqual(draws(777))
    // Pinned goldens: these ARE the replay contract. They depend on the run
    // seed AND on names/elf_female.txt's contents+order — editing that file (or
    // the seeding) is expected to change them; an accidental change is a bug.
    expect(draws(777)[0]).toBe('Chiyo')
    expect(draws(2026)[0]).toBe('Hina')
  })

  it("a pool's order depends only on its own sub-seed (run seed + pool key)", () => {
    // Different run seeds give (with overwhelming likelihood) different orders;
    // this is what makes each pool's stream independent of the others.
    expect(new NameRegistry(1).draw('elf', 'female', 'x')).not.toBe(
      new NameRegistry(2).draw('elf', 'female', 'x'),
    )
  })

  it('draws are sequential and unique until the pool is exhausted, then fall back', () => {
    const r = new NameRegistry(2026)
    const seen = new Set<string>()
    let fallback: string | null = null
    for (let i = 0; i < 500; i++) {
      const name = r.draw('elf', 'female', `id${i}`)
      if (name.startsWith('Unnamed-')) {
        fallback = name
        break
      }
      expect(seen.has(name)).toBe(false) // no repeats within a pool
      seen.add(name)
    }
    expect(seen.size).toBeGreaterThan(0)
    expect(fallback).toBe(`Unnamed-id${seen.size}`) // stable, unique fallback on exhaustion
  })

  it('an unpopulated (species, gender) cell falls back to a stable unique name', () => {
    const r = new NameRegistry(2026)
    expect(r.draw('orc', 'male', 'ork#3')).toBe('Unnamed-ork#3')
  })
})

// --- the promotion trigger: a pure readout of the combat chronicle ----------

describe('enduredFocus — the promotion trigger readout', () => {
  const combat = (targetId: string, hpAfter: number): LogEntry => ({
    kind: 'combat',
    message: 'hit',
    data: { targetId, targetHpAfter: hpAfter },
  })

  it('lowestHpReached tracks the low-water mark from blows aimed at the unit only', () => {
    const log = [combat('a', 12), combat('b', 3), combat('a', 5), combat('a', 9)]
    expect(lowestHpReached(log, 'a', 20)).toBe(5) // b's blow is ignored
    expect(lowestHpReached(log, 'c', 20)).toBe(20) // never hit -> fallback
  })

  it('is a downward crossing: started >= threshold AND driven below it', () => {
    const unit = instantiateUnit(runContent, 'sakura', 's') // maxHp 20
    const M = unit.stats.maxHp
    const cutoff = M * PROMOTION_HP_FRACTION
    const below = Math.ceil(cutoff) - 1
    const atOrAbove = Math.ceil(cutoff)

    // Entered full, driven below -> crosses.
    expect(enduredFocus(unit, [combat('s', below)], M)).toBe(true)
    // Entered full, never driven below -> no crossing.
    expect(enduredFocus(unit, [combat('s', atOrAbove)], M)).toBe(false)
    expect(enduredFocus(unit, [], M)).toBe(false) // untouched at full

    // Entered ALREADY below threshold (a walked-in wound) and merely survived:
    // must NOT promote, even though the low-water mark is below the line.
    expect(enduredFocus(unit, [combat('s', below - 1)], below)).toBe(false)
    // Entered at 45% (>= threshold), beaten to 30% (< threshold), survived -> crosses.
    expect(enduredFocus(unit, [combat('s', Math.round(0.3 * M))], Math.round(0.45 * M))).toBe(true)
  })
})

// --- gradual recovery: deterministic, HP-only ------------------------------

describe('recoveredHp — gradual wound recovery', () => {
  it('knits back a fixed integer step per encounter, capped at max', () => {
    const M = 24
    const step = Math.max(1, Math.floor(RECOVERY_FRACTION * M)) // floor(6) = 6
    expect(step).toBe(6)
    expect(recoveredHp(10, M)).toBe(16)
    expect(recoveredHp(20, M)).toBe(M) // 26 capped to 24
    expect(recoveredHp(M, M)).toBe(M) // already full stays full
  })

  it('always heals at least 1 (tiny units are never stuck)', () => {
    // maxHp 3 -> floor(0.25*3) = 0, so max(1, 0) = 1.
    expect(recoveredHp(1, 3)).toBe(2)
    expect(recoveredHp(2, 3)).toBe(3)
  })

  it('N encounters lands a unit at min(M, H + N*step)', () => {
    const M = 20
    const step = Math.max(1, Math.floor(RECOVERY_FRACTION * M)) // 5
    let hp = 3
    for (let n = 1; n <= 6; n++) {
      hp = recoveredHp(hp, M)
      expect(hp).toBe(Math.min(M, 3 + n * step))
    }
  })
})

// --- end-to-end through the run: identity genesis ---------------------------

// Drive a whole run with roster[idx] turned into a levy. Abilities are stripped
// so the elf evolve-on-level rename can't confound the assertion that a promoted
// name is exactly the drawn pool name (promotion is name+tier only).
function playWithLevy(seed: number, idx = 0) {
  const run = new Run({ seed })
  const levy = run.roster[idx]
  levy.unit.tier = 'levy'
  levy.unit.name = 'Deepwood Levy'
  levy.unit.abilities = []
  const baseStats = { ...levy.unit.stats }
  const id = levy.unit.id
  let guard = 0
  while (run.phase === 'roster' && guard++ < 20) {
    run.chooseEncounter(0)
    const battle = run.deploy(run.roster.slice(0, run.maxDeployable()).map((e) => e.unit.id))
    autoPlay(battle)
    run.finishBattle()
  }
  const entry = [...run.roster, ...run.fallen].find((e) => e.unit.id === id)!
  return { run, entry, id, baseStats }
}

describe('run — levy→named promotion (identity genesis)', () => {
  it('a deployed levy that endured focus fire is named from its culture pool', () => {
    // Find the first seed where the levy actually earns its name.
    let found: ReturnType<typeof playWithLevy> | null = null
    let usedSeed = -1
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const r = playWithLevy(seed)
      if (r.entry.unit.tier === 'named') {
        found = r
        usedSeed = seed
      }
    }
    expect(found).not.toBeNull()
    const { entry, id, baseStats } = found!

    // It graduated tier and took the expected name: the sole levy draws the
    // first name of that seed's shuffled elf_female pool.
    expect(entry.unit.tier).toBe('named')
    expect(entry.unit.name).toBe(new NameRegistry(usedSeed).draw('elf', 'female', id))

    // Name-only: no stats gained, no abilities gained, from the promotion.
    expect(entry.unit.stats).toEqual(baseStats)
    expect(entry.unit.abilities.length).toBe(0)

    // The chronicle records it.
    expect(found!.run.log.some((e) => e.kind === 'promotion')).toBe(true)

    // Replay: the same seed + choices yields the same name and the same
    // promotion log entries, in the same order.
    const replay = playWithLevy(usedSeed)
    expect(replay.entry.unit.name).toBe(entry.unit.name)
    expect(replay.entry.unit.tier).toBe('named')
    expect(replay.run.log.filter((e) => e.kind === 'promotion')).toEqual(
      found!.run.log.filter((e) => e.kind === 'promotion'),
    )
  })

  it('a benched levy never promotes (and takes no damage to endure)', () => {
    const run = new Run({ seed: 10 })
    const levy = run.roster[0]
    levy.unit.tier = 'levy'
    levy.unit.name = 'Deepwood Levy'
    levy.unit.abilities = []
    run.chooseEncounter(0)
    // Field everyone EXCEPT the levy.
    const battle = run.deploy(run.roster.slice(1, run.maxDeployable() + 1).map((e) => e.unit.id))
    autoPlay(battle)
    run.finishBattle()

    const still = [...run.roster, ...run.fallen].find((e) => e.unit.id === levy.unit.id)!
    expect(still.unit.tier).toBe('levy')
    expect(still.unit.name).toBe('Deepwood Levy')
  })

  it('deploy no longer heals to full: a wounded unit fights at its current HP', () => {
    const run = new Run({ seed: 3 })
    const wounded = run.roster[0] // Sakura, maxHp 20
    wounded.unit.hp = 5
    run.chooseEncounter(0)
    const battle = run.deploy(run.roster.slice(0, run.maxDeployable()).map((e) => e.unit.id))
    // The same unit object enters the battle — still at 5, not healed to 20.
    expect(battle.unitById(wounded.unit.id)!.hp).toBe(5)
  })

  it('a benched survivor recovers a fixed step between encounters (uniform, HP-only)', () => {
    const run = new Run({ seed: 3 })
    const benched = run.roster[0] // Sakura, maxHp 20 -> step floor(0.25*20) = 5
    benched.unit.hp = 5
    run.chooseEncounter(0)
    // Field everyone EXCEPT the wounded unit; it takes no damage, only recovers.
    const battle = run.deploy(run.roster.slice(1, run.maxDeployable() + 1).map((e) => e.unit.id))
    autoPlay(battle)
    run.finishBattle()
    const after = run.roster.find((e) => e.unit.id === benched.unit.id)!
    expect(after.unit.hp).toBe(10) // 5 + 5, uncapped
    expect(after.unit.stats.maxHp).toBe(20) // maxHp untouched
  })

  it('a levy that dies never promotes, even having been driven low', () => {
    let observed = false
    for (let seed = 1; seed <= 14 && !observed; seed++) {
      const run = new Run({ seed })
      const levy = run.roster[5] // Mei — fragile; likely to lose solo
      levy.unit.tier = 'levy'
      levy.unit.name = 'Levy Scout'
      levy.unit.abilities = []
      run.chooseEncounter(0)
      const battle = run.deploy([levy.unit.id])
      autoPlay(battle)
      run.finishBattle()
      if (battle.outcome === 'enemy_win') {
        const fallen = run.fallen.find((e) => e.unit.id === levy.unit.id)!
        expect(fallen).toBeTruthy()
        expect(fallen.unit.alive).toBe(false)
        expect(fallen.unit.tier).toBe('levy') // dead: never named
        expect(fallen.unit.name).toBe('Levy Scout')
        expect(fallen.unit.hp).toBe(0) // dead: never recovered off 0
        observed = true
      }
    }
    expect(observed).toBe(true)
  })
})

describe('run — wound is legible at the deploy decision', () => {
  it('the deployment view shows current HP vs max', () => {
    const run = new Run({ seed: 3 })
    run.roster[0].unit.hp = 5 // Sakura wounded (maxHp 20)
    run.chooseEncounter(0)
    const html = deployHTML(run, new Set())
    expect(html).toContain('HP 5/20') // wounded unit: current/max both shown
    expect(html).toContain('HP 22/22') // a full unit still shows current/max
  })
})
