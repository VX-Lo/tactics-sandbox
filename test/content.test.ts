import { describe, it, expect } from 'vitest'
import { loadContent, instantiateUnit, defaultContent } from '../src/engine/content'

describe('content loader', () => {
  it('loads and indexes the bundled content', () => {
    expect(Object.keys(defaultContent.units)).toContain('sakura')
    expect(Object.keys(defaultContent.units)).toContain('wight')
    expect(defaultContent.terrain.forest.avoidBonus).toBe(20)
    expect(defaultContent.abilities.evolve_on_kill.trigger).toBe('on_kill')
  })

  it('rejects a unit referencing an unknown ability', () => {
    expect(() =>
      loadContent(
        [{ id: 'plain', name: 'P', color: '#000', moveCost: 1, defBonus: 0, avoidBonus: 0, passable: true }],
        [],
        [
          {
            id: 'x',
            name: 'X',
            glyph: 'x',
            faction: 'player',
            stats: { maxHp: 1, atk: 1, def: 1, spd: 1, skl: 1 },
            movement: { points: 1 },
            attack: { minRange: 1, maxRange: 1, hit: 1, crit: 1 },
            abilities: ['does_not_exist'],
          },
        ],
      ),
    ).toThrow(/unknown ability/)
  })

  it('rejects an ability with an unknown trigger', () => {
    expect(() =>
      loadContent([], [{ id: 'bad', name: 'Bad', trigger: 'on_sneeze', effects: [] }], []),
    ).toThrow(/unknown trigger/)
  })

  it('rejects duplicate ids', () => {
    const t = { id: 'plain', name: 'P', color: '#000', moveCost: 1, defBonus: 0, avoidBonus: 0, passable: true }
    expect(() => loadContent([t, t], [], [])).toThrow(/duplicate/)
  })

  it('instantiates a unit with full HP, copied stats, and resolved abilities', () => {
    const u = instantiateUnit(defaultContent, 'hana', 'hana#1')
    expect(u.hp).toBe(u.stats.maxHp)
    expect(u.alive).toBe(true)
    expect(u.abilities[0].id).toBe('evolve_on_kill')
    // Mutating an instance's stats must not leak into the template.
    u.stats.atk += 5
    expect(defaultContent.units.hana.stats.atk).toBe(9)
  })
})
