import { describe, it, expect } from 'vitest'
import { Battle } from '../src/engine/battle'
import { autoPlay } from '../src/engine/ai'

describe('battle setup', () => {
  it('deploys the default roster on opposite sides, all alive', () => {
    const b = new Battle({ seed: 2026 })
    expect(b.living('player').map((u) => u.defId).sort()).toEqual(['aoi', 'hana', 'sakura', 'yuki'])
    expect(b.living('enemy')).toHaveLength(6)
    // Players deploy west of enemies (center-out from the left/right edges).
    const avg = (us: { pos: { x: number } }[]) => us.reduce((s, u) => s + u.pos.x, 0) / us.length
    expect(avg(b.living('player'))).toBeLessThan(avg(b.living('enemy')))
    // No two units share a tile.
    const keys = b.state.units.map((u) => `${u.pos.x},${u.pos.y}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('starts in player phase, turn 1, ongoing', () => {
    const b = new Battle({ seed: 5 })
    expect(b.state.phase).toBe('player')
    expect(b.state.turn).toBe(1)
    expect(b.outcome).toBe('ongoing')
  })
})

describe('battle commands', () => {
  it('rejects moving an enemy unit during the player phase', () => {
    const b = new Battle({ seed: 3 })
    const enemy = b.living('enemy')[0]
    expect(b.moveUnit(enemy.id, { x: enemy.pos.x, y: enemy.pos.y })).toBe(false)
  })

  it('a unit cannot move after it has acted', () => {
    const b = new Battle({ seed: 3 })
    const u = b.living('player')[0]
    b.waitUnit(u.id)
    expect(b.moveUnit(u.id, u.pos)).toBe(false)
    expect(b.destinations(u)).toEqual([])
  })

  it('endPhase flips sides and bumps the turn when player phase reopens', () => {
    const b = new Battle({ seed: 3 })
    b.endPhase()
    expect(b.state.phase).toBe('enemy')
    expect(b.state.turn).toBe(1)
    b.endPhase()
    expect(b.state.phase).toBe('player')
    expect(b.state.turn).toBe(2)
  })
})

describe('determinism / replay', () => {
  it('same seed + same policy => byte-identical battle', () => {
    const a = new Battle({ seed: 2026 })
    const b = new Battle({ seed: 2026 })
    autoPlay(a)
    autoPlay(b)
    // Full mutable world matches: positions, HP, names, learned abilities, log.
    expect(a.state).toEqual(b.state)
    expect(a.log).toEqual(b.log)
  })

  it('different seeds generally diverge', () => {
    const a = new Battle({ seed: 1 })
    const b = new Battle({ seed: 999 })
    autoPlay(a)
    autoPlay(b)
    expect(a.log).not.toEqual(b.log)
  })

  it('a full auto-played battle reaches a decisive outcome', () => {
    const b = new Battle({ seed: 2026 })
    autoPlay(b)
    expect(b.outcome).not.toBe('ongoing')
  })
})

describe('evolution in a real battle', () => {
  it('at least one unit evolves (new ability + renamed) when kills happen', () => {
    // Find a seed whose auto-play produces a player kill, then assert evolution.
    let evolvedSomewhere = false
    for (const seed of [2026, 1, 7, 42, 99]) {
      const b = new Battle({ seed })
      autoPlay(b)
      const evolved = b.state.units.find(
        (u) => u.faction === 'player' && u.abilities.length > 1 && u.name.includes(' '),
      )
      if (evolved) {
        evolvedSomewhere = true
        // Its extra ability came from the evolution pool.
        expect(evolved.abilities.some((a) => a.id !== 'evolve_on_kill')).toBe(true)
        break
      }
    }
    expect(evolvedSomewhere).toBe(true)
  })
})
