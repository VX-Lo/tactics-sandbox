// App controller. Owns the Battle instance and the view state, translates
// clicks into engine commands, and steps the enemy phase for readability. It
// never computes game rules itself — every question (where can I move? what can
// I hit? what would this fight do?) is asked of the Battle API. Presentation is
// downstream of simulation, full stop.

import './style.css'
import { Battle } from '../engine/battle'
import { takeUnitTurn } from '../engine/ai'
import { boardHTML, unitPanelHTML, forecastHTML, logHTML, type ViewState } from './render'

const app = document.getElementById('app')!
app.innerHTML = `
  <header class="topbar">
    <h1>Elves of the Deepwood</h1>
    <span class="turn" id="turnInfo"></span>
    <span class="outcome" id="outcome"></span>
    <span class="spacer"></span>
    <div class="controls">
      <label class="muted">seed <input id="seedInput" value="2026" /></label>
      <button id="randomBtn">Random</button>
      <button id="newBtn">New Battle</button>
      <button id="endBtn">End Turn ⏎</button>
    </div>
  </header>
  <div id="board"></div>
  <div id="sidebar">
    <div class="card"><h2>Selected</h2><div id="unitPanel"></div><div id="forecast"></div></div>
    <div class="card"><h2>Chronicle</h2><div id="log"></div></div>
    <div class="card"><h2>Legend</h2>
      <div class="muted">▲ high ground (uphill attacks crit more) · forest shields defenders · water & crags block.
      Move (blue), then strike an enemy in range (red). A kill makes an elf evolve.</div>
    </div>
  </div>`

const boardEl = document.getElementById('board') as HTMLDivElement
const turnInfoEl = document.getElementById('turnInfo')!
const outcomeEl = document.getElementById('outcome')!
const unitPanelEl = document.getElementById('unitPanel')!
const forecastEl = document.getElementById('forecast')!
const logEl = document.getElementById('log')!
const seedInput = document.getElementById('seedInput') as HTMLInputElement
const endBtn = document.getElementById('endBtn') as HTMLButtonElement

let battle: Battle
let view: ViewState = { selectedId: null, destinations: new Set(), attackable: new Set() }
let busy = false // true while the enemy phase auto-runs; input is locked

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tileKey = (x: number, y: number) => `${x},${y}`

function newBattle(seed: number): void {
  battle = new Battle({ seed })
  boardEl.style.gridTemplateColumns = `repeat(${battle.state.grid.width}, var(--cell))`
  clearSelection()
  render()
}

function clearSelection(): void {
  view = { selectedId: null, destinations: new Set(), attackable: new Set() }
  forecastEl.innerHTML = ''
}

function select(unitId: string): void {
  const u = battle.unitById(unitId)
  if (!u || u.faction !== 'player' || u.hasActed || battle.state.phase !== 'player') return
  const dests = new Set(
    battle.destinations(u).map((c) => tileKey(c.x, c.y)),
  )
  dests.delete(tileKey(u.pos.x, u.pos.y)) // don't highlight the tile it's already on
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
      select(selected.id) // recompute: now shows attack targets from the new tile
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
  battle.endPhase() // player -> enemy
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
      await delay(280)
    }
  }
  if (battle.outcome === 'ongoing') battle.endPhase() // enemy -> player (fires turn-start regen)
  busy = false
  render()
}

// --- rendering ---------------------------------------------------------------

function render(): void {
  boardEl.innerHTML = boardHTML(battle, view)
  const phaseCls = battle.state.phase === 'player' ? 'phase-player' : 'phase-enemy'
  turnInfoEl.innerHTML = `Turn ${battle.state.turn} · <span class="${phaseCls}">${battle.state.phase} phase</span>`

  outcomeEl.className = 'outcome'
  if (battle.outcome === 'player_win') { outcomeEl.textContent = 'Victory'; outcomeEl.classList.add('win') }
  else if (battle.outcome === 'enemy_win') { outcomeEl.textContent = 'Defeat'; outcomeEl.classList.add('loss') }
  else outcomeEl.textContent = ''

  const sel = view.selectedId ? battle.unitById(view.selectedId) : undefined
  unitPanelEl.innerHTML = unitPanelHTML(sel)

  logEl.innerHTML = logHTML(battle.log)
  logEl.scrollTop = logEl.scrollHeight

  updateControls()
}

function updateControls(): void {
  endBtn.disabled = busy || battle.outcome !== 'ongoing' || battle.state.phase !== 'player'
}

// --- wiring ------------------------------------------------------------------

boardEl.addEventListener('click', (e) => {
  const cell = (e.target as HTMLElement).closest('.cell') as HTMLElement | null
  if (cell) onCellClick(Number(cell.dataset.x), Number(cell.dataset.y))
})
boardEl.addEventListener('mousemove', (e) => {
  const cell = (e.target as HTMLElement).closest('.cell') as HTMLElement | null
  if (cell) onCellHover(Number(cell.dataset.x), Number(cell.dataset.y))
})
boardEl.addEventListener('mouseleave', () => { forecastEl.innerHTML = '' })

endBtn.addEventListener('click', () => void endTurn())
document.getElementById('newBtn')!.addEventListener('click', () => {
  const seed = Number(seedInput.value) || 0
  newBattle(seed)
})
document.getElementById('randomBtn')!.addEventListener('click', () => {
  // UI-only randomness (choosing which deterministic battle to play) — never
  // touches the engine's seeded stream.
  const seed = Math.floor(Math.random() * 1_000_000)
  seedInput.value = String(seed)
  newBattle(seed)
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !endBtn.disabled) void endTurn()
})

newBattle(Number(seedInput.value) || 2026)
