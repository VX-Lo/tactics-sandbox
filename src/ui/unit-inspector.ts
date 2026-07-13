// Read-only unit inspection panel: a self-contained presentational component.
// Given a live Unit, describes it fully — identity/tier, current vs max HP,
// movement range, attack range, attacks remaining/budget, and current
// abilities. Pure (Unit -> HTML): it reads existing unit state and decides
// nothing, mutates nothing, rolls no dice.
//
// Deliberately separate from render.ts's `unitPanelHTML` (the compact sidebar
// readout used during move/attack targeting, which battle-view.ts wires into
// the existing reachable-highlight flow) — this is an additional reference
// view, not a replacement for it.

import type { Unit } from '../engine/types'
import { TIER_LABELS } from '../engine/types'

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function unitInspectorHTML(unit: Unit | undefined): string {
  if (!unit) return '<span class="muted">No unit selected.</span>'
  const s = unit.stats
  const abilities = unit.abilities.length
    ? unit.abilities
        .map(
          (a) =>
            `<li><span class="ab-name">${esc(a.name)}</span>${a.description ? ` <span class="muted">— ${esc(a.description)}</span>` : ''}</li>`,
        )
        .join('')
    : '<li class="muted">no abilities</li>'
  return `
    <div class="inspector-head">
      <span class="unit-name ${unit.faction}">${esc(unit.name)}</span>
      <span class="tier-tag ${unit.tier}">${esc(TIER_LABELS[unit.tier])}</span>
    </div>
    <div class="inspector-stats">
      <div><span class="k">HP</span> ${unit.hp}/${s.maxHp}</div>
      <div><span class="k">Move range</span> ${unit.movementRemaining}/${unit.movement.points}</div>
      <div><span class="k">Attack range</span> ${unit.attack.minRange}-${unit.attack.maxRange}</div>
      <div><span class="k">Attacks</span> ${unit.attacksRemaining}/${unit.attackBudget}</div>
    </div>
    <ul class="abilities">${abilities}</ul>`
}
