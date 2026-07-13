// A mountable battle view: given a container and a Battle, it renders the board
// and sidebar, handles selection/move/attack/hover, and steps the enemy phase.
// It calls onEnd when the player acknowledges a concluded battle (Continue).
//
// Extracted from the standalone controller so both the single-battle sandbox
// and the run layer drive the exact same battle UI. Like everything upstream,
// it asks the Battle API every question and computes no rules itself.

import { Battle } from '../engine/battle'
import { takeUnitTurn } from '../engine/ai'
import { ELEVATION_CRIT_PER_LEVEL } from '../engine/combat'
import type { Unit } from '../engine/types'
import {
  boardHTML,
  unitPanelHTML,
  forecastHTML,
  logHTML,
  tileTooltipHTML,
  unitTooltipHTML,
  type ViewState,
  type UnitProgress,
} from './render'
import { unitInspectorHTML } from './unit-inspector'

export interface BattleViewOptions {
  /** Called when the player clicks Continue after the battle has concluded. */
  onEnd?: () => void
  /** Optional banner HTML shown at the left of the battle top bar. */
  headerHTML?: string
  /** Live level/XP for a unit's tooltip; absent in the standalone sandbox. */
  progressFor?: (unit: Unit) => UnitProgress | undefined
}

export interface BattleViewHandle {
  destroy(): void
}

export function mountBattleView(
  container: HTMLElement,
  battle: Battle,
  options: BattleViewOptions = {},
): BattleViewHandle {
  container.innerHTML = `
    <div class="battle-view">
      <div class="battle-topbar">
        <div class="banner">${options.headerHTML ?? ''}</div>
        <span class="turn" id="turnInfo"></span>
        <span class="outcome" id="outcome"></span>
        <span class="spacer"></span>
        <button id="undoBtn" hidden>Undo (U)</button>
        <button id="waitBtn" hidden>Wait (W)</button>
        <button id="endBtn">End Turn ⏎</button>
        <button id="continueBtn" hidden>Continue →</button>
      </div>
      <div id="tooltip" class="tooltip" hidden></div>
      <div class="battle-main">
        <div id="board"></div>
        <div id="sidebar">
          <div class="card"><h2>Selected</h2><div id="unitPanel"></div><div id="forecast"></div></div>
          <div class="card"><h2>Inspect</h2><div id="unitInspector"></div></div>
          <div class="card"><h2>Chronicle</h2><div id="log"></div></div>
          <div class="card"><h2>Legend</h2>
            <div class="muted">▲ high ground · ▾ low ground (hover any tile for exact height).
            High ground: +${ELEVATION_CRIT_PER_LEVEL}% crit per level when attacking from above (the higher tile wins).
            Forest shields defenders; water &amp; crags block.
            Move (blue), then strike an enemy in range (red).
            Kills earn XP; a level-up evolves an elf mid-fight.</div>
          </div>
        </div>
      </div>
    </div>`

  const q = <T extends HTMLElement>(sel: string) => container.querySelector(sel) as T
  const boardEl = q<HTMLDivElement>('#board')
  const turnInfoEl = q('#turnInfo')
  const outcomeEl = q('#outcome')
  const unitPanelEl = q('#unitPanel')
  const unitInspectorEl = q('#unitInspector')
  const forecastEl = q('#forecast')
  const logEl = q('#log')
  const endBtn = q<HTMLButtonElement>('#endBtn')
  const waitBtn = q<HTMLButtonElement>('#waitBtn')
  const undoBtn = q<HTMLButtonElement>('#undoBtn')
  const continueBtn = q<HTMLButtonElement>('#continueBtn')
  const tooltipEl = q<HTMLDivElement>('#tooltip')

  boardEl.style.gridTemplateColumns = `repeat(${battle.state.grid.width}, var(--cell))`

  let view: ViewState = { selectedId: null, destinations: new Set(), attackable: new Set() }
  let busy = false // locked while the enemy phase auto-runs

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const tileKey = (x: number, y: number) => `${x},${y}`

  function clearSelection(): void {
    battle.endActivation() // leaving the unit closes its undo activation
    view = { selectedId: null, destinations: new Set(), attackable: new Set() }
    forecastEl.innerHTML = ''
  }

  function select(unitId: string): void {
    const u = battle.unitById(unitId)
    if (!u || u.faction !== 'player' || u.spent || battle.state.phase !== 'player') return
    // Open (or keep) this unit's undo activation. Idempotent for the same unit,
    // so the re-selects that refresh highlights after a move/attack/undo do NOT
    // reset the stack; selecting a different unit starts a fresh one.
    battle.beginActivation(unitId)
    const dests = new Set(battle.destinations(u).map((c) => tileKey(c.x, c.y)))
    dests.delete(tileKey(u.pos.x, u.pos.y))
    view = {
      selectedId: unitId,
      destinations: dests,
      attackable: new Set(battle.attackTargets(u).map((t) => t.id)),
    }
    forecastEl.innerHTML = ''
    render()
  }

  function onCellClick(x: number, y: number): void {
    if (busy || battle.outcome !== 'ongoing') return
    const occ = battle.living().find((u) => u.pos.x === x && u.pos.y === y)
    const selected = view.selectedId ? battle.unitById(view.selectedId) : undefined

    if (selected) {
      if (occ && view.attackable.has(occ.id)) {
        battle.attack(selected.id, occ.id)
        // Move-shoot-move: attacking no longer ends the turn, so keep the unit
        // selected to expose any leftover movement (highlights refresh to the
        // now-spent attack budget + remaining move range). Clear only if the
        // battle just ended.
        if (battle.outcome === 'ongoing') select(selected.id)
        else { clearSelection(); render() }
        return
      }
      if (view.destinations.has(tileKey(x, y))) {
        // A unit may move repeatedly while movementRemaining lasts; re-select to
        // roll the reachable highlight and budget forward.
        battle.moveUnit(selected.id, { x, y })
        select(selected.id)
        return
      }
      if (occ && occ.faction === 'player' && !occ.spent) {
        select(occ.id)
        return
      }
      clearSelection()
      render()
      return
    }
    if (occ && occ.faction === 'player' && !occ.spent) select(occ.id)
  }

  function onCellHover(x: number, y: number): void {
    const selected = view.selectedId ? battle.unitById(view.selectedId) : undefined
    const occ = battle.living().find((u) => u.pos.x === x && u.pos.y === y)
    if (selected && occ && view.attackable.has(occ.id)) {
      forecastEl.innerHTML = forecastHTML(selected, occ, battle.forecast(selected, occ))
    } else {
      forecastEl.innerHTML = ''
    }
  }

  // Floating hover tooltip: unit summary over a unit, terrain summary over bare
  // ground. Content is read from live terrain/unit data (no hardcoding).
  function showTooltip(x: number, y: number, clientX: number, clientY: number): void {
    const { grid } = battle.state
    const tile = grid.tiles[y * grid.width + x]
    if (!tile) return hideTooltip()
    const terrain = battle.content.terrain[tile.terrain]
    const occ = battle.living().find((u) => u.pos.x === x && u.pos.y === y)
    tooltipEl.innerHTML = occ
      ? unitTooltipHTML(occ, { terrain, elevation: tile.elevation }, options.progressFor?.(occ))
      : tileTooltipHTML(terrain, tile.elevation)
    tooltipEl.hidden = false

    // Offset from the cursor, flipping near the right/bottom edges.
    const pad = 14
    const r = tooltipEl.getBoundingClientRect()
    let left = clientX + pad
    let top = clientY + pad
    if (left + r.width > window.innerWidth - 8) left = clientX - r.width - pad
    if (top + r.height > window.innerHeight - 8) top = clientY - r.height - pad
    tooltipEl.style.left = `${Math.max(4, left)}px`
    tooltipEl.style.top = `${Math.max(4, top)}px`
  }

  function hideTooltip(): void {
    tooltipEl.hidden = true
  }

  // Rewind the selected unit's last reversible action, then refresh its view so
  // the reachable highlights and Move/Attacks readout roll back live.
  function doUndo(): void {
    if (busy || battle.outcome !== 'ongoing') return
    if (!view.selectedId || !battle.canUndo()) return
    battle.undo()
    select(view.selectedId) // recomputes destinations/attackable from restored state
  }

  // End the selected unit's activation early (it has done what the player wants).
  function waitSelected(): void {
    if (busy || battle.outcome !== 'ongoing') return
    const sel = view.selectedId ? battle.unitById(view.selectedId) : undefined
    if (!sel || sel.faction !== 'player' || sel.spent) return
    battle.waitUnit(sel.id)
    clearSelection()
    render()
  }

  async function endTurn(): Promise<void> {
    if (busy || battle.outcome !== 'ongoing') return
    clearSelection()
    battle.endPhase()
    render()
    await runEnemyPhase()
  }

  async function runEnemyPhase(): Promise<void> {
    busy = true
    updateControls()
    const ids = battle.living('enemy').map((u) => u.id).sort()
    for (const id of ids) {
      if (battle.outcome !== 'ongoing') break
      const u = battle.unitById(id)
      if (u && u.alive && !u.spent) {
        takeUnitTurn(battle, u)
        render()
        await delay(260)
      }
    }
    if (battle.outcome === 'ongoing') battle.endPhase()
    busy = false
    render()
  }

  function render(): void {
    boardEl.innerHTML = boardHTML(battle, view)
    const phaseCls = battle.state.phase === 'player' ? 'phase-player' : 'phase-enemy'
    turnInfoEl.innerHTML = `Turn ${battle.state.turn} · <span class="${phaseCls}">${battle.state.phase} phase</span>`

    outcomeEl.className = 'outcome'
    if (battle.outcome === 'player_win') { outcomeEl.textContent = 'Victory'; outcomeEl.classList.add('win') }
    else if (battle.outcome === 'enemy_win') { outcomeEl.textContent = 'Defeat'; outcomeEl.classList.add('loss') }
    else outcomeEl.textContent = ''

    unitPanelEl.innerHTML = unitPanelHTML(view.selectedId ? battle.unitById(view.selectedId) : undefined)
    unitInspectorEl.innerHTML = unitInspectorHTML(view.selectedId ? battle.unitById(view.selectedId) : undefined)
    logEl.innerHTML = logHTML(battle.log)
    logEl.scrollTop = logEl.scrollHeight
    updateControls()
  }

  function updateControls(): void {
    const over = battle.outcome !== 'ongoing'
    endBtn.disabled = busy || over || battle.state.phase !== 'player'
    endBtn.hidden = over
    // Wait/Undo are offered only while a still-active player unit is selected;
    // Undo enables once the unit has a reversible action on its stack.
    const sel = view.selectedId ? battle.unitById(view.selectedId) : undefined
    const commanding =
      !!sel && sel.faction === 'player' && !sel.spent && !busy && !over && battle.state.phase === 'player'
    waitBtn.hidden = !commanding
    undoBtn.hidden = !commanding
    undoBtn.disabled = !battle.canUndo()
    // Offer Continue only once the battle is decided and a handler wants it.
    continueBtn.hidden = !(over && options.onEnd && !busy)
  }

  // --- listeners (tracked for teardown) --------------------------------------
  const onClick = (e: MouseEvent) => {
    const cell = (e.target as HTMLElement).closest('.cell') as HTMLElement | null
    if (cell) onCellClick(Number(cell.dataset.x), Number(cell.dataset.y))
  }
  const onMove = (e: MouseEvent) => {
    const cell = (e.target as HTMLElement).closest('.cell') as HTMLElement | null
    if (cell) {
      const x = Number(cell.dataset.x)
      const y = Number(cell.dataset.y)
      onCellHover(x, y)
      showTooltip(x, y, e.clientX, e.clientY)
    } else {
      hideTooltip()
    }
  }
  const onLeave = () => {
    forecastEl.innerHTML = ''
    hideTooltip()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !endBtn.disabled && !endBtn.hidden) void endTurn()
    else if ((e.key === 'w' || e.key === 'W') && !waitBtn.hidden) waitSelected()
    else if ((e.key === 'u' || e.key === 'U') && !undoBtn.hidden && !undoBtn.disabled) doUndo()
  }

  boardEl.addEventListener('click', onClick)
  boardEl.addEventListener('mousemove', onMove)
  boardEl.addEventListener('mouseleave', onLeave)
  endBtn.addEventListener('click', () => void endTurn())
  waitBtn.addEventListener('click', () => waitSelected())
  undoBtn.addEventListener('click', () => doUndo())
  continueBtn.addEventListener('click', () => options.onEnd?.())
  window.addEventListener('keydown', onKey)

  render()

  return {
    destroy() {
      window.removeEventListener('keydown', onKey)
      container.innerHTML = ''
    },
  }
}
