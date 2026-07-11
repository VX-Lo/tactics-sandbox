import { describe, it, expect } from 'vitest'
import { Run } from '../src/run/run'
import { autoPlay } from '../src/engine/ai'

// Drive a whole run headlessly: greedy auto-play each battle, always take the
// given encounter choice. This is the run analogue of the engine's replay test.
function playRun(seed: number, pick: (run: Run) => number = () => 0): Run {
  const run = new Run({ seed })
  let guard = 0
  while (run.phase === 'roster' && guard++ < 20) {
    const battle = run.choose(pick(run))
    autoPlay(battle)
    run.finishBattle()
  }
  return run
}

describe('run — determinism', () => {
  it('same seed + same choices => identical run', () => {
    const a = playRun(2026)
    const b = playRun(2026)
    expect(a.snapshot()).toEqual(b.snapshot())
    expect(a.log).toEqual(b.log)
  })

  it('reaches a terminal phase', () => {
    const run = playRun(2026)
    expect(['won', 'lost']).toContain(run.phase)
  })
})

describe('run — structure', () => {
  it('offers three fresh encounters on each roster screen', () => {
    const run = new Run({ seed: 3 })
    expect(run.encounters).toHaveLength(3)
    const first = run.encounters.map((e) => e.id)
    const b = run.choose(0)
    autoPlay(b)
    run.finishBattle()
    if (run.phase === 'roster') {
      expect(run.encounters).toHaveLength(3)
      expect(run.encounters.map((e) => e.id)).not.toEqual(first) // regenerated
    }
  })

  it('a won run completes exactly totalBattles fights', () => {
    const run = playRun(2026)
    if (run.phase === 'won') expect(run.battleIndex).toBe(run.totalBattles)
  })
})

describe('run — persistence and evolution', () => {
  it('survivors heal to full at the start of the next battle', () => {
    const run = new Run({ seed: 2026 })
    const b1 = run.choose(0)
    autoPlay(b1)
    run.finishBattle()
    if (run.phase === 'roster') {
      run.choose(0) // heals survivors as it fields them
      for (const e of run.roster) expect(e.unit.hp).toBe(e.unit.stats.maxHp)
    }
  })

  it('permadeath: the fallen leave the roster and never share an id with it', () => {
    const run = playRun(2026)
    const rosterIds = new Set(run.roster.map((e) => e.unit.id))
    for (const f of run.fallen) {
      expect(f.unit.alive).toBe(false)
      expect(rosterIds.has(f.unit.id)).toBe(false)
    }
    expect(run.roster.length + run.fallen.length).toBeLessThanOrEqual(4)
  })

  it('at least one unit evolves over a run (level up + new ability + rename)', () => {
    let evolved = false
    for (const seed of [2026, 1, 7, 42, 99, 123]) {
      const run = playRun(seed)
      const all = [...run.roster, ...run.fallen]
      if (all.some((e) => e.level > 1 && e.unit.abilities.length > 1 && e.unit.name.includes(' '))) {
        evolved = true
        break
      }
    }
    expect(evolved).toBe(true)
  })
})
