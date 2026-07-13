// The inspection panel is a pure (Unit -> HTML) presentational function: no
// DOM, no battle mutation. These tests assert the rendered content is
// correct for a given unit, that it updates when the selected unit changes,
// clears on deselect, and that calling it never touches battle state.

import { describe, it, expect } from 'vitest'
import { Battle } from '../src/engine/battle'
import { unitInspectorHTML } from '../src/ui/unit-inspector'
import { place, uniformGrid } from './helpers'

describe('unitInspectorHTML — read-only unit inspection panel', () => {
  it('shows name, tier, current/max HP, movement range, attack range, attacks remaining/budget', () => {
    const u = place('sakura', 'p1', { x: 0, y: 0 }) // named, ranger (range 2-2)
    u.hp = 12 // wounded, below max
    u.movementRemaining = 3
    u.attacksRemaining = 0

    const html = unitInspectorHTML(u)

    expect(html).toContain('Sakura')
    expect(html).toContain('Named')
    expect(html).toContain(`${u.hp}/${u.stats.maxHp}`) // 12/20
    expect(html).toContain(`${u.movementRemaining}/${u.movement.points}`) // 3/5
    expect(html).toContain(`${u.attack.minRange}-${u.attack.maxRange}`) // 2-2
    expect(html).toContain(`${u.attacksRemaining}/${u.attackBudget}`) // 0/1
  })

  it('lists the unit\'s current abilities by name', () => {
    const u = place('sakura', 'p1', { x: 0, y: 0 })
    expect(u.abilities.length).toBeGreaterThan(0)
    const html = unitInspectorHTML(u)
    for (const a of u.abilities) expect(html).toContain(a.name)
  })

  it('shows a placeholder when a unit has no abilities', () => {
    const u = place('sakura', 'p1', { x: 0, y: 0 })
    u.abilities = []
    expect(unitInspectorHTML(u)).toContain('no abilities')
  })

  it('reflects a levy tier distinctly from named', () => {
    const named = place('sakura', 'p1', { x: 0, y: 0 })
    named.tier = 'named'
    const levy = place('sakura', 'p2', { x: 1, y: 0 })
    levy.tier = 'levy'
    expect(unitInspectorHTML(named)).toContain('Named')
    expect(unitInspectorHTML(levy)).toContain('Levy')
  })

  it('updates when the selected unit changes', () => {
    const a = place('sakura', 'p1', { x: 0, y: 0 })
    const b = place('hana', 'p2', { x: 1, y: 0 })
    const htmlA = unitInspectorHTML(a)
    const htmlB = unitInspectorHTML(b)
    expect(htmlA).toContain('Sakura')
    expect(htmlA).not.toContain('Hana')
    expect(htmlB).toContain('Hana')
    expect(htmlB).not.toContain('Sakura')
  })

  it('clears (renders a placeholder, not stale data) on deselect', () => {
    const html = unitInspectorHTML(undefined)
    expect(html).not.toContain('Sakura')
    expect(html).toMatch(/no unit selected/i)
  })
})

describe('unitInspectorHTML — no battle-state mutation', () => {
  it('rendering (repeatedly, including a deselect) leaves the battle and unit untouched', () => {
    const p = place('sakura', 'p1', { x: 1, y: 1 })
    const e = place('skeleton', 'e1', { x: 4, y: 1 })
    const battle = new Battle({ seed: 1, playerRoster: [], enemyRoster: [] })
    battle.state.grid = uniformGrid(6, 4, 'plain')
    battle.state.units = [p, e]

    const before = JSON.parse(JSON.stringify(battle.state))

    // Simulate "opening" and "closing" the panel repeatedly for both units.
    unitInspectorHTML(p)
    unitInspectorHTML(e)
    unitInspectorHTML(undefined) // deselect

    expect(battle.state).toEqual(before)
  })
})
