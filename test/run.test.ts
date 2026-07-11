import { describe, it, expect } from 'vitest'
import { Run } from '../src/run/run'
import { autoPlay } from '../src/engine/ai'

// Drive a whole run headlessly: pick an encounter, deploy a subset, greedy
// auto-play the battle. Default deployment policy = the first `cap` units in
// roster order. This is the run analogue of the engine's replay test.
const firstCap = (run: Run) => run.roster.slice(0, run.maxDeployable()).map((e) => e.unit.id)

function playRun(
  seed: number,
  pick: (run: Run) => number = () => 0,
  deployPick: (run: Run) => string[] = firstCap,
): Run {
  const run = new Run({ seed })
  let guard = 0
  while (run.phase === 'roster' && guard++ < 20) {
    run.chooseEncounter(pick(run))
    const battle = run.deploy(deployPick(run))
    autoPlay(battle)
    run.finishBattle()
  }
  return run
}

describe('run — determinism', () => {
  it('same seed + same encounter/deployment choices => identical run', () => {
    const a = playRun(2026)
    const b = playRun(2026)
    expect(a.snapshot()).toEqual(b.snapshot())
    expect(a.log).toEqual(b.log)
    // Deployment picks are recorded and part of the replayable state.
    expect(a.deploymentHistory.length).toBe(a.battleIndex)
    expect(a.deploymentHistory).toEqual(b.deploymentHistory)
  })

  it('a different deployment policy diverges from the default', () => {
    const a = playRun(2026, () => 0, firstCap)
    // Field the LAST cap units instead of the first.
    const b = playRun(2026, () => 0, (run) =>
      run.roster.slice(-run.maxDeployable()).map((e) => e.unit.id),
    )
    expect(a.deploymentHistory).not.toEqual(b.deploymentHistory)
  })

  it('reaches a terminal phase', () => {
    expect(['won', 'lost']).toContain(playRun(2026).phase)
  })
})

describe('run — structure', () => {
  it('roster exceeds the field cap, making deployment a real choice', () => {
    const run = new Run({ seed: 3 })
    expect(run.roster.length).toBe(6)
    expect(run.fieldCap).toBe(4)
    expect(run.maxDeployable()).toBe(4)
  })

  it('encounter pick advances to deploy, deploy starts the battle', () => {
    const run = new Run({ seed: 3 })
    run.chooseEncounter(0)
    expect(run.phase).toBe('deploy')
    expect(run.pendingEncounter).not.toBeNull()
    const battle = run.deploy(firstCap(run))
    expect(run.phase).toBe('battle')
    expect(battle.living('player').length).toBe(4) // only the cap is fielded
  })

  it('cancelDeploy returns to the roster without recording anything', () => {
    const run = new Run({ seed: 3 })
    run.chooseEncounter(1)
    run.cancelDeploy()
    expect(run.phase).toBe('roster')
    expect(run.pendingEncounter).toBeNull()
    expect(run.deploymentHistory).toEqual([])
  })

  it('deploy rejects selections outside 1..cap', () => {
    const run = new Run({ seed: 3 })
    run.chooseEncounter(0)
    expect(() => run.deploy(run.roster.map((e) => e.unit.id))).toThrow(/between 1 and/) // 6 > cap
    expect(() => run.deploy([])).toThrow(/between 1 and/)
    // Still deployable after a rejected attempt.
    expect(run.deploy(firstCap(run)).living('player').length).toBe(4)
  })

  it('when the roster is at or below the cap, everyone can be fielded', () => {
    const run = new Run({ seed: 5, roster: ['sakura', 'hana', 'yuki'], fieldCap: 4 })
    expect(run.maxDeployable()).toBe(3)
    run.chooseEncounter(0)
    expect(run.deploy(run.roster.map((e) => e.unit.id)).living('player').length).toBe(3)
  })
})

describe('run — deployment and the bench', () => {
  it('deployed units heal to full; only the cap is fielded', () => {
    const run = new Run({ seed: 2026 })
    run.chooseEncounter(0)
    const battle = run.deploy(firstCap(run))
    for (const u of battle.living('player')) expect(u.hp).toBe(u.stats.maxHp)
    expect(battle.living('player').length).toBe(run.maxDeployable())
  })

  it('benched units earn no XP and cannot die; deployed ones do earn XP', () => {
    const run = new Run({ seed: 2026 })
    run.chooseEncounter(0)
    const deployedIds = firstCap(run)
    const benchedIds = run.roster.filter((e) => !deployedIds.includes(e.unit.id)).map((e) => e.unit.id)
    const battle = run.deploy(deployedIds)
    autoPlay(battle)
    run.finishBattle()

    const find = (id: string) => [...run.roster, ...run.fallen].find((e) => e.unit.id === id)!
    for (const id of benchedIds) {
      const e = find(id)
      expect(e.xp).toBe(0)
      expect(e.level).toBe(1)
      expect(e.unit.alive).toBe(true) // could not have taken damage
      expect(run.roster).toContain(e) // never retired to the fallen
    }
    // Someone who actually fought earned XP.
    expect(deployedIds.map(find).some((e) => e.xp > 0)).toBe(true)
  })

  it('a lost battle with benched survivors continues the run', () => {
    let observed = false
    for (let seed = 1; seed <= 14 && !observed; seed++) {
      const run = new Run({ seed })
      run.chooseEncounter(0)
      const solo = run.roster[5].unit.id // Mei alone — fragile, likely to lose
      const battle = run.deploy([solo])
      autoPlay(battle)
      run.finishBattle()
      if (battle.outcome === 'enemy_win') {
        // The one deployed unit died; the five benched survive and the run goes on.
        expect(run.roster.length).toBe(5)
        expect(run.phase).not.toBe('lost')
        expect(run.fallen.some((e) => e.unit.id === solo)).toBe(true)
        observed = true
      }
    }
    expect(observed).toBe(true)
  })
})

describe('run — persistence and evolution', () => {
  it('permadeath: the fallen leave the roster and never share an id with it', () => {
    const run = playRun(2026)
    const rosterIds = new Set(run.roster.map((e) => e.unit.id))
    for (const f of run.fallen) {
      expect(f.unit.alive).toBe(false)
      expect(rosterIds.has(f.unit.id)).toBe(false)
    }
    expect(run.roster.length + run.fallen.length).toBeLessThanOrEqual(6)
  })

  it('at least one unit evolves over a run (level up + new ability + rename)', () => {
    let evolved = false
    for (const seed of [2026, 1, 7, 42, 99, 123]) {
      const all = [...playRun(seed).roster, ...playRun(seed).fallen]
      if (all.some((e) => e.level > 1 && e.unit.abilities.length > 1 && e.unit.name.includes(' '))) {
        evolved = true
        break
      }
    }
    expect(evolved).toBe(true)
  })
})
