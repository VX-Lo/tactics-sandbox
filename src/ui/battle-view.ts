// A mountable battle view: given a container and a Battle, it renders the board
// and sidebar, handles selection/move/attack/hover, and steps the enemy phase.
// It calls onEnd when the player acknowledges a concluded battle (Continue).
//
// Extracted from the standalone controller so both the single-battle sandbox
// and the run layer drive the exact same battle UI. Like everything upstream,
// it asks the Battle API every question and computes no rules itself.

import { Battle } from '../engine/battle'
import { takeUnitTurn } from '../engine/ai'
import { boardHTML, unitPanelHTML, forecastHTML, logHTML, type ViewState } from './render'

export interface BattleViewOptions {
  /** Called when the player clicks Continue after the battle has concluded. */
  onEnd?: () => void
  /** Optional banner HTML shown at the left of the battle top bar. */
  headerHTML?: string
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
        <button id="endBtn">End Turn ⏎</button>
        <button id="continueBtn" hidden>Continue →</button>
      </div>
      <div class="battle-main">
        <div id="board"></div>
        <div id="sidebar">
          <div class="card"><h2>Selected</h2><div id="unitPanel"></div><div id="forecast"></div></div>
          <div class="card"><h2>Chronicle</h2><div id="log"></div></div>
          <div class="card"><h2>Legend</h2>
            <div class="muted">▲ high ground (uphill attacks crit more) · forest shields defenders ·
            water &amp; crags block. Move (blue), then strike an enemy in range (red).
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
  const forecastEl = q('#forecast')
  const logEl = q('#log')
  const endBtn = q<HTMLButtonElement>('#endBtn')
  const continueBtn = q<HTMLButtonElement>('#continueBtn')

  boardEl.style.gridTemplateColumns = `repeat(${battle.state.grid.width}, var(--cell))`

  let view: ViewState = { selectedId: null, destinations: new Set(), attackable: new Set() }
  let busy = false // locked while the enemy phase auto-runs

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const tileKey = (x: number, y: number) => `${x},${y}`

  function clearSelection(): void {
    view = { selectedId: null, destinations: new Set(), attackable: new Set() }
    forecastEl.innerHTML = ''
  }

  function select(unitId: string): void {
    const u = battle.unitById(unitId)
    if (!u || u.faction !== 'player' || u.hasActed || battle.state.phase !== 'player') return
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
        clearSelection()
        render()
        return
      }
      if (!selected.hasMoved && view.destinations.has(tileKey(x, y))) {
        battle.moveUnit(selected.id, { x, y })
        select(selected.id)
        return
      }
      if (occ && occ.faction === 'player' && !occ.hasActed) {
        select(occ.id)
        return
      }
      clearSelection()
      render()
      return
    }
    if (occ && occ.faction === 'player' && !occ.hasActed) select(occ.id)
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
      if (u && u.alive && !u.hasActed) {
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
    logEl.innerHTML = logHTML(battle.log)
    logEl.scrollTop = logEl.scrollHeight
    updateControls()
  }

  function updateControls(): void {
    const over = battle.outcome !== 'ongoing'
    endBtn.disabled = busy || over || battle.state.phase !== 'player'
    endBtn.hidden = over
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
    if (cell) onCellHover(Number(cell.dataset.x), Number(cell.dataset.y))
  }
  const onLeave = () => { forecastEl.innerHTML = '' }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !endBtn.disabled && !endBtn.hidden) void endTurn()
  }

  boardEl.addEventListener('click', onClick)
  boardEl.addEventListener('mousemove', onMove)
  boardEl.addEventListener('mouseleave', onLeave)
  endBtn.addEventListener('click', () => void endTurn())
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
