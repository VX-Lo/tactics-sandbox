// View construction: pure functions from (battle, view state) to HTML strings.
// No game logic lives here — it only reads the Battle and renders. The
// controller (main.ts) owns state and wiring. Keeping render pure makes the
// separation of simulation and presentation literal.

import type { Battle } from '../engine/battle'
import type { Forecast } from '../engine/combat'
import type { LogEntry, Unit } from '../engine/types'

export interface ViewState {
  selectedId: string | null
  /** "x,y" tiles the selected unit can move to. */
  destinations: Set<string>
  /** unit ids the selected unit can attack. */
  attackable: Set<string>
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function boardHTML(battle: Battle, view: ViewState): string {
  const { grid } = battle.state
  const byTile = new Map<string, Unit>()
  for (const u of battle.living()) byTile.set(`${u.pos.x},${u.pos.y}`, u)

  const selected = view.selectedId ? battle.unitById(view.selectedId) : undefined
  let html = ''
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const tile = grid.tiles[y * grid.width + x]
      const terrain = battle.content.terrain[tile.terrain]
      const key = `${x},${y}`
      const occ = byTile.get(key)

      const classes = ['cell', `elev-${tile.elevation}`]
      if (view.destinations.has(key)) classes.push('move')
      if (occ && view.attackable.has(occ.id)) classes.push('attack')
      if (selected && occ && occ.id === selected.id) classes.push('selected')

      const clickable =
        view.destinations.has(key) ||
        (occ && (view.attackable.has(occ.id) || (occ.faction === 'player' && !occ.hasActed)))
      if (clickable) classes.push('clickable')

      let inner = ''
      // Height is the crit driver, so show it explicitly: elevated tiles carry a
      // corner number (flat ground stays unmarked to keep the board quiet).
      if (tile.elevation > 0)
        inner += `<span class="elev-mark lvl${tile.elevation}" aria-hidden="true">${tile.elevation}</span>`
      if (occ) {
        const spent = occ.faction === 'player' && occ.hasActed ? ' spent' : ''
        inner += `<span class="glyph ${occ.faction}${spent}">${esc(occ.glyph)}</span>`
        const pct = Math.max(0, Math.round((occ.hp / occ.stats.maxHp) * 100))
        const low = occ.hp / occ.stats.maxHp <= 0.34 ? ' low' : ''
        inner += `<div class="hp"><span class="${low.trim()}" style="width:${pct}%"></span></div>`
      }

      html += `<div class="${classes.join(' ')}" style="background:${terrain.color}" data-x="${x}" data-y="${y}">${inner}</div>`
    }
  }
  return html
}

export function unitPanelHTML(unit: Unit | undefined): string {
  if (!unit) return '<span class="muted">Click one of your elves to select her.</span>'
  const s = unit.stats
  const abilities = unit.abilities
    .map((a) => `<li><span class="ab-name">${esc(a.name)}</span> <span class="muted">— ${esc(a.description ?? '')}</span></li>`)
    .join('')
  return `
    <div class="unit-name ${unit.faction}">${esc(unit.name)} <span class="muted">${esc(unit.glyph)}</span></div>
    <div class="muted">${unit.faction === 'player' ? 'Elf of the Deepwood' : 'Undead'} · ${unit.kills} kill${unit.kills === 1 ? '' : 's'}</div>
    <div class="stats">
      <div><span class="k">HP</span> ${unit.hp}/${s.maxHp}</div>
      <div><span class="k">Move</span> ${unit.movement.points}</div>
      <div><span class="k">Atk</span> ${s.atk}</div>
      <div><span class="k">Def</span> ${s.def}</div>
      <div><span class="k">Spd</span> ${s.spd}</div>
      <div><span class="k">Skl</span> ${s.skl}</div>
      <div><span class="k">Range</span> ${unit.attack.minRange}-${unit.attack.maxRange}</div>
      <div><span class="k">Crit</span> ${unit.attack.crit}%</div>
    </div>
    <ul class="abilities">${abilities}</ul>`
}

export function forecastHTML(attacker: Unit, defender: Unit, f: Forecast): string {
  const side = (cls: string, name: string, s: Forecast['attacker'] | null): string => {
    if (!s) return `<div class="row ${cls}"><span>${esc(name)}</span><span class="muted">no counter</span></div>`
    const dmg = s.doubles ? `${s.damage}×2` : `${s.damage}`
    return `<div class="row ${cls}"><span>${esc(name)}</span><span>${dmg} dmg · ${s.hit}% hit · ${s.crit}% crit</span></div>`
  }
  return `
    <div class="forecast">
      <h2>Forecast</h2>
      ${side('att', attacker.name, f.attacker)}
      ${side('def', defender.name, f.defender)}
    </div>`
}

export function logHTML(entries: LogEntry[]): string {
  return entries
    .map((e) => `<div class="entry k-${e.kind}">${esc(e.message)}</div>`)
    .join('')
}
