import { describe, it, expect } from 'vitest'
import { Battle } from '../src/engine/battle'
import { classifyAction } from '../src/engine/commitment'
import { uniformGrid } from './helpers'
import type { Coord } from '../src/engine/types'

// A battle on a flat plain corridor with hand-placed units, so movement costs are
// exactly manhattan distance and undo state is trivial to reason about.
function flatBattle(playerDefs: string[], enemyDefs: string[]): Battle {
  const b = new Battle({ seed: 1, playerRoster: playerDefs, enemyRoster: enemyDefs })
  b.state.grid = uniformGrid(14, 5, 'plain')
  return b
}
const key = (c: Coord) => `${c.x},${c.y}`

// --- the commitment policy seam --------------------------------------------

describe('commitment policy — "commit on reveal"', () => {
  it('an attack commits (resolves RNG); a move is reversible', () => {
    expect(classifyAction('attack')).toBe('committing')
    expect(classifyAction('move')).toBe('reversible')
  })
})

// --- restoration -----------------------------------------------------------

describe('undo — restores exact prior turn-state', () => {
  it('single and repeated undo rewind position, budgets, and the reachable set', () => {
    const b = flatBattle(['yuki'], ['skeleton']) // yuki move 4
    const p = b.living('player')[0]
    b.living('enemy')[0].pos = { x: 13, y: 0 } // parked far away
    p.pos = { x: 0, y: 2 }
    b.beginActivation(p.id)

    const dest0 = new Set(b.destinations(p).map(key))
    const m0 = p.movementRemaining
    const a0 = p.attacksRemaining

    b.moveUnit(p.id, { x: 2, y: 2 }) // cost 2
    b.moveUnit(p.id, { x: 2, y: 4 }) // cost 2 -> 0 left
    expect(p.movementRemaining).toBe(m0 - 4)
    expect(b.canUndo()).toBe(true)

    // Undo once: back to the (2,2) state exactly.
    expect(b.undo()).toBe(true)
    expect(p.pos).toEqual({ x: 2, y: 2 })
    expect(p.movementRemaining).toBe(m0 - 2)
    expect(p.attacksRemaining).toBe(a0)

    // Undo again: back to activation-start, reachable set restored byte-for-byte.
    expect(b.undo()).toBe(true)
    expect(p.pos).toEqual({ x: 0, y: 2 })
    expect(p.movementRemaining).toBe(m0)
    expect(p.attacksRemaining).toBe(a0)
    expect(new Set(b.destinations(p).map(key))).toEqual(dest0)

    // Nothing left to undo.
    expect(b.canUndo()).toBe(false)
    expect(b.undo()).toBe(false)
  })
})

// --- the commit invariant (the critical one) -------------------------------

describe('undo — the commit invariant', () => {
  it('after an attack, undo cannot reach or pass it; a post-attack move undoes only to the commit point', () => {
    const b = flatBattle(['yuki'], ['skeleton', 'skeleton'])
    const p = b.living('player')[0]
    const [e1, e2] = b.living('enemy')
    p.pos = { x: 0, y: 2 }
    e1.pos = { x: 3, y: 2 }
    e2.pos = { x: 0, y: 0 } // far — keeps the battle ongoing after e1 is hit/killed
    b.beginActivation(p.id)

    // Leading move, then the attack that commits.
    b.moveUnit(p.id, { x: 2, y: 2 }) // adjacent to e1
    expect(b.canUndo()).toBe(true)
    b.attack(p.id, e1.id)
    expect(p.attacksRemaining).toBe(0)

    // The attack (a committing action) is NOT reversible, and the leading move is
    // gone with it: nothing at/before the attack can be undone.
    expect(b.canUndo()).toBe(false)
    expect(b.undo()).toBe(false)

    const postAttack = { ...p.pos } // (2,2)

    // Trailing move (move-attack-move): undoable, but only back to the commit point.
    b.moveUnit(p.id, { x: 2, y: 4 })
    expect(b.canUndo()).toBe(true)
    expect(b.undo()).toBe(true)
    expect(p.pos).toEqual(postAttack)
    expect(p.attacksRemaining).toBe(0) // the attack stays committed — no re-roll
    expect(b.canUndo()).toBe(false) // cannot pass the commit
    expect(b.undo()).toBe(false)
  })
})

// --- activation scope ------------------------------------------------------

describe('undo — activation scope (intra-unit, current-activation only)', () => {
  const opened = (): { b: Battle; p: Battle['state']['units'][number] } => {
    const b = flatBattle(['yuki'], ['skeleton'])
    const p = b.living('player')[0]
    b.living('enemy')[0].pos = { x: 13, y: 0 }
    p.pos = { x: 0, y: 2 }
    b.beginActivation(p.id)
    b.moveUnit(p.id, { x: 2, y: 2 })
    expect(b.canUndo()).toBe(true)
    return { b, p }
  }

  it('switching to another unit closes the activation and clears the stack', () => {
    const b = flatBattle(['yuki', 'sakura'], ['skeleton'])
    const [p1, p2] = b.living('player')
    b.living('enemy')[0].pos = { x: 13, y: 0 }
    p1.pos = { x: 0, y: 2 }
    p2.pos = { x: 0, y: 4 }
    b.beginActivation(p1.id)
    b.moveUnit(p1.id, { x: 2, y: 2 })
    expect(b.canUndo()).toBe(true)
    b.beginActivation(p2.id) // switch selection
    expect(b.canUndo()).toBe(false) // p1's move is no longer undoable
  })

  it('Wait closes the activation', () => {
    const { b, p } = opened()
    b.waitUnit(p.id)
    expect(b.canUndo()).toBe(false)
  })

  it('phase end closes the activation', () => {
    const { b } = opened()
    b.endPhase()
    expect(b.canUndo()).toBe(false)
  })

  it('endActivation (deselect) closes it; re-selecting the same unit starts empty', () => {
    const { b, p } = opened()
    b.endActivation()
    expect(b.canUndo()).toBe(false)
    b.beginActivation(p.id) // re-select after closing = a NEW activation
    expect(b.canUndo()).toBe(false) // fresh empty stack, prior move not undoable
  })

  it('re-selecting the SAME unit mid-activation preserves the stack (idempotent open)', () => {
    const { b, p } = opened()
    b.beginActivation(p.id) // the UI does this to refresh highlights after a move
    expect(b.canUndo()).toBe(true) // stack NOT reset
  })

  it('empty-stack undo is a safe no-op, with or without an open activation', () => {
    const b = flatBattle(['yuki'], ['skeleton'])
    const p = b.living('player')[0]
    expect(b.canUndo()).toBe(false)
    expect(b.undo()).toBe(false) // no activation
    b.beginActivation(p.id)
    expect(b.canUndo()).toBe(false)
    expect(b.undo()).toBe(false) // open but empty
  })
})

// --- determinism / replay --------------------------------------------------

describe('undo — determinism (consumes no randomness, leaves no trace)', () => {
  // Replay is re-simulation from seed + encounter choices + deployment picks;
  // player battle actions are NEVER recorded, so undone moves have no record to
  // enter. The observable guarantee is that undo perturbs no PRNG stream: a
  // committed action after undo-fumbling resolves byte-identically to one taken
  // with no fumbling at all.
  const setup = (): { b: Battle; p: Battle['state']['units'][number]; e: Battle['state']['units'][number] } => {
    const b = flatBattle(['yuki'], ['skeleton', 'skeleton'])
    const p = b.living('player')[0]
    const [e1, e2] = b.living('enemy')
    p.pos = { x: 2, y: 2 }
    e1.pos = { x: 3, y: 2 } // adjacent target
    e2.pos = { x: 0, y: 0 }
    return { b, p, e: e1 }
  }

  it('move → undo leaves the PRNG untouched: the next attack resolves identically', () => {
    const A = setup()
    A.b.beginActivation(A.p.id)
    A.b.moveUnit(A.p.id, { x: 2, y: 1 }) // wander
    A.b.undo() // rewind to start
    expect(A.p.pos).toEqual({ x: 2, y: 2 })
    const rA = A.b.attack(A.p.id, A.e.id)

    const B = setup()
    const rB = B.b.attack(B.p.id, B.e.id) // same seed, no undo dance

    expect(rA).toEqual(rB) // identical combat resolution -> undo drew no RNG
    const hps = (b: Battle) => b.state.units.map((u) => ({ id: u.id, hp: u.hp, alive: u.alive }))
    expect(hps(A.b)).toEqual(hps(B.b)) // committed outcome is byte-identical
  })
})
