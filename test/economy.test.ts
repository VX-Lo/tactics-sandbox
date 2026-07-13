import { describe, it, expect } from 'vitest'
import { Battle } from '../src/engine/battle'
import { instantiateUnit, defaultContent } from '../src/engine/content'
import { uniformGrid } from './helpers'
import type { Coord } from '../src/engine/types'

// A battle on a flat plain corridor with hand-placed units, so movement costs
// are exactly manhattan distance and the action economy is easy to reason about.
// (We swap in a uniform grid and reposition the deployed units.)
function flatBattle(playerDef: string, enemyDefs: string[]): Battle {
  const b = new Battle({ seed: 1, playerRoster: [playerDef], enemyRoster: enemyDefs })
  b.state.grid = uniformGrid(14, 5, 'plain')
  return b
}
const at = (b: Battle, faction: 'player' | 'enemy', i = 0) => b.living(faction)[i]

describe('action economy — budgets and initialisation', () => {
  it('a fresh unit starts with full budgets, one attack, not spent', () => {
    const u = instantiateUnit(defaultContent, 'yuki', 'y') // move 4
    expect(u.movementRemaining).toBe(u.movement.points)
    expect(u.attackBudget).toBe(1)
    expect(u.attacksRemaining).toBe(1)
    expect(u.spent).toBe(false)
  })
})

describe('action economy — movement is a spendable budget', () => {
  it('each move deducts its path cost; a unit may move repeatedly while budget lasts', () => {
    const b = flatBattle('yuki', ['skeleton']) // yuki move 4
    const p = at(b, 'player')
    at(b, 'enemy').pos = { x: 13, y: 0 } // parked far away
    p.pos = { x: 0, y: 2 }
    expect(p.movementRemaining).toBe(4)

    expect(b.moveUnit(p.id, { x: 2, y: 2 })).toBe(true) // cost 2
    expect(p.pos).toEqual({ x: 2, y: 2 })
    expect(p.movementRemaining).toBe(2)

    expect(b.moveUnit(p.id, { x: 2, y: 4 })).toBe(true) // cost 2 more -> 0 left
    expect(p.movementRemaining).toBe(0)

    // Budget exhausted: no further move, and no tile but its own is a destination.
    expect(b.moveUnit(p.id, { x: 3, y: 4 })).toBe(false)
    expect(b.destinations(p)).toEqual([{ x: 2, y: 4 }])
  })

  it('reachability shrinks to the remaining budget after a partial move', () => {
    const b = flatBattle('yuki', ['skeleton'])
    const p = at(b, 'player')
    at(b, 'enemy').pos = { x: 13, y: 0 }
    p.pos = { x: 0, y: 2 }
    const maxReach = (u = p) => Math.max(...b.destinations(u).map((c: Coord) => Math.abs(c.x - u.pos.x) + Math.abs(c.y - u.pos.y)))
    expect(maxReach()).toBe(4) // full budget
    b.moveUnit(p.id, { x: 1, y: 2 }) // spend 1
    expect(maxReach()).toBe(3) // only 3 left from the new tile
  })
})

describe('action economy — attacks are a separate budget', () => {
  it('attacking spends an attack, not movement, and does not end the activation', () => {
    const b = flatBattle('yuki', ['skeleton', 'skeleton'])
    const p = at(b, 'player')
    const [e1, e2] = b.living('enemy')
    p.pos = { x: 0, y: 2 }
    e1.pos = { x: 1, y: 2 } // adjacent (range 1)
    e2.pos = { x: 0, y: 1 } // also adjacent; keeps the battle alive and stays in range
    const moveBefore = p.movementRemaining

    expect(b.attack(p.id, e1.id)).not.toBeNull()
    expect(p.attacksRemaining).toBe(0)
    expect(p.movementRemaining).toBe(moveBefore) // attack cost no movement
    expect(p.spent).toBe(false) // free ordering: not ended

    // attackBudget default 1: no second attack even with an in-range target left.
    expect(b.attackTargets(p)).toEqual([])
    expect(b.attack(p.id, e2.id)).toBeNull()
  })
})

describe('action economy — free ordering (move-shoot-move)', () => {
  it('a unit can move after attacking while movement remains', () => {
    const b = flatBattle('yuki', ['skeleton', 'skeleton'])
    const p = at(b, 'player')
    const [e1, e2] = b.living('enemy')
    p.pos = { x: 5, y: 2 }
    e1.pos = { x: 6, y: 2 } // adjacent target
    e2.pos = { x: 0, y: 0 } // far — guarantees the battle stays ongoing after the kill/hit

    b.attack(p.id, e1.id)
    expect(p.attacksRemaining).toBe(0)
    expect(b.outcome).toBe('ongoing')
    const rem = p.movementRemaining

    expect(b.moveUnit(p.id, { x: 5, y: 0 })).toBe(true) // MOVE AFTER ATTACK
    expect(p.pos).toEqual({ x: 5, y: 0 })
    expect(p.movementRemaining).toBe(rem - 2)
  })

  it('supports move, attack, then move again in one activation', () => {
    const b = flatBattle('yuki', ['skeleton', 'skeleton'])
    const p = at(b, 'player')
    const [e1, e2] = b.living('enemy')
    p.pos = { x: 0, y: 2 }
    e1.pos = { x: 3, y: 2 }
    e2.pos = { x: 0, y: 0 }

    expect(b.moveUnit(p.id, { x: 2, y: 2 })).toBe(true) // step adjacent, cost 2
    expect(b.attack(p.id, e1.id)).not.toBeNull()
    expect(b.moveUnit(p.id, { x: 2, y: 4 })).toBe(true) // reposition, cost 2
    expect(p.movementRemaining).toBe(0)
    expect(p.attacksRemaining).toBe(0)
  })
})

describe('action economy — ending an activation', () => {
  it('waitUnit ends the activation: spent, budgets zeroed, no more actions', () => {
    const b = flatBattle('yuki', ['skeleton'])
    const p = at(b, 'player')
    at(b, 'enemy').pos = { x: 13, y: 0 }
    p.pos = { x: 0, y: 2 }

    expect(b.waitUnit(p.id)).toBe(true)
    expect(p.spent).toBe(true)
    expect(p.movementRemaining).toBe(0)
    expect(p.attacksRemaining).toBe(0)
    expect(b.destinations(p)).toEqual([])
    expect(b.attackTargets(p)).toEqual([])
    expect(b.moveUnit(p.id, { x: 1, y: 2 })).toBe(false)
  })

  it('beginPhase (via a full phase cycle) refills budgets and clears spent', () => {
    const b = flatBattle('yuki', ['skeleton'])
    const p = at(b, 'player')
    at(b, 'enemy').pos = { x: 13, y: 0 }
    p.pos = { x: 0, y: 2 }

    b.moveUnit(p.id, { x: 2, y: 2 })
    b.waitUnit(p.id)
    expect(p.spent).toBe(true)

    b.endPhase() // -> enemy phase
    b.endPhase() // -> player phase again: resets
    expect(p.movementRemaining).toBe(p.movement.points)
    expect(p.attacksRemaining).toBe(p.attackBudget)
    expect(p.spent).toBe(false)
  })
})
