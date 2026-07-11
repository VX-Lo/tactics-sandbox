// Standalone single-battle sandbox: pick a seed, play one deterministic battle.
// A thin wrapper around the shared BattleView; the run layer uses the same view.

import './style.css'
import { Battle } from '../engine/battle'
import { mountBattleView, type BattleViewHandle } from './battle-view'

const app = document.getElementById('app')!
app.innerHTML = `
  <header class="topbar">
    <h1>Elves of the Deepwood — Skirmish</h1>
    <span class="spacer"></span>
    <div class="controls">
      <label class="muted">seed <input id="seedInput" value="2026" /></label>
      <button id="randomBtn">Random</button>
      <button id="newBtn">New Battle</button>
      <a class="muted linklike" href="/index.html">▶ Play a full run</a>
    </div>
  </header>
  <div id="viewport"></div>`

const viewport = document.getElementById('viewport') as HTMLDivElement
const seedInput = document.getElementById('seedInput') as HTMLInputElement
let handle: BattleViewHandle | null = null

function newBattle(seed: number): void {
  handle?.destroy()
  handle = mountBattleView(viewport, new Battle({ seed }))
}

document.getElementById('newBtn')!.addEventListener('click', () => newBattle(Number(seedInput.value) || 0))
document.getElementById('randomBtn')!.addEventListener('click', () => {
  // UI-only randomness (choosing which deterministic battle to play).
  const seed = Math.floor(Math.random() * 1_000_000)
  seedInput.value = String(seed)
  newBattle(seed)
})

newBattle(Number(seedInput.value) || 2026)
