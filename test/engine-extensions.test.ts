import { describe, it, expect } from 'vitest'
import { Battle } from '../src/engine/battle'
import { makeAbilitySystem } from '../src/engine/abilities'
import { makeRng } from '../src/engine/rng'
import { defaultContent, instantiateUnit } from '../src/engine/content'
import type { EffectContext } from '../src/engine/types'
import { uniformGrid, makeState } from './helpers'

describe('tier field', () => {
  it('instantiated units carry tier from their template (default levy)', () => {
    expect(instantiateUnit(defaultContent, 'sakura', 's').tier).toBe('named')
    expect(instantiateUnit(defaultContent, 'skeleton', 'z').tier).toBe('levy')
  })
})

describe('playerUnits injection', () => {
  it('deploys the exact instances and does not re-apply their on_gain passives', () => {
    // Build a persistent unit and apply a passive (+2 atk) once, as a prior
    // battle would have.
    const u = instantiateUnit(defaultContent, 'hana', 'hana#persist') // atk 9
    const sys = makeAbilitySystem()
    const ctx: EffectContext = {
      state: makeState(uniformGrid(3, 3), [u]),
      content: defaultContent,
      rng: makeRng(1),
      log: () => {},
    }
    u.abilities.push(defaultContent.abilities.keen_arm)
    sys.applyOnGain(ctx, u, defaultContent.abilities.keen_arm)
    expect(u.stats.atk).toBe(11)

    // Inject it into a battle; it must be the SAME object, placed on the board,
    // with its atk unchanged (no second on_gain application).
    const battle = new Battle({ seed: 7, playerUnits: [u], enemyRoster: ['skeleton'] })
    expect(battle.unitById('hana#persist')).toBe(u)
    expect(u.stats.atk).toBe(11)
    expect(battle.living('player')).toContain(u)
    // Position was assigned and is in bounds.
    expect(u.pos.x).toBeGreaterThanOrEqual(0)
    expect(u.pos.x).toBeLessThan(battle.state.grid.width)
  })

  it('falls back to instantiating the roster when no playerUnits given', () => {
    const battle = new Battle({ seed: 7, playerRoster: ['aoi'], enemyRoster: ['skeleton'] })
    expect(battle.living('player').map((u) => u.defId)).toEqual(['aoi'])
  })
})
