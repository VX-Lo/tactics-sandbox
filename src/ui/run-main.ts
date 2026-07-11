// Run controller: sequences roster screens and battles. It reads the Run's
// state to decide what to show, mounts the shared BattleView for each chosen
// encounter, and calls run.finishBattle() when the player acknowledges the
// result. All progression/XP/evolution lives in the run layer beneath it.

import './style.css'
import { Run } from '../run/run'
import { BIOMES } from '../run/biomes'
import { DIFFICULTIES } from '../run/encounters'
import { levelProgress } from '../run/progression'
import { mountBattleView, type BattleViewHandle } from './battle-view'
import { rosterHTML, deployHTML, endHTML } from './run-render'

const app = document.getElementById('app')!
let run: Run
let battleHandle: BattleViewHandle | null = null
// Deployment selection, owned by the controller until deploy() commits it.
let selected = new Set<string>()

function startRun(seed: number): void {
  battleHandle?.destroy()
  battleHandle = null
  run = new Run({ seed })
  renderRun()
}

function renderRun(): void {
  if (run.phase === 'roster') renderRoster()
  else if (run.phase === 'deploy') renderDeploy()
  else if (run.phase === 'won' || run.phase === 'lost') renderEnd()
}

function renderRoster(): void {
  battleHandle?.destroy()
  battleHandle = null
  app.innerHTML = rosterHTML(run)
  app.querySelectorAll<HTMLElement>('[data-encounter]').forEach((el) =>
    el.addEventListener('click', () => {
      run.chooseEncounter(Number(el.dataset.encounter))
      selected = new Set() // start empty; the player must choose who fights
      renderRun()
    }),
  )
  wireChrome()
}

function renderDeploy(): void {
  app.innerHTML = deployHTML(run, selected)
  const cap = run.maxDeployable()
  const toggle = (id: string): void => {
    if (selected.has(id)) selected.delete(id)
    else if (selected.size < cap) selected.add(id) // cap enforced on the way in
    renderDeploy()
  }
  app.querySelectorAll<HTMLElement>('[data-deploy-toggle]').forEach((el) => {
    el.addEventListener('click', () => toggle(el.dataset.deployToggle!))
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle(el.dataset.deployToggle!)
      }
    })
  })
  document.getElementById('deployBtn')?.addEventListener('click', () => {
    if (selected.size >= 1 && selected.size <= cap) enterBattle([...selected])
  })
  document.getElementById('backBtn')?.addEventListener('click', () => {
    run.cancelDeploy()
    renderRun()
  })
  wireChrome()
}

function enterBattle(ids: string[]): void {
  const enc = run.pendingEncounter!
  const header = `<strong>Battle ${run.battleIndex + 1}/${run.totalBattles}</strong> — ${BIOMES[enc.biome].label} · ${DIFFICULTIES[enc.difficulty].label}`
  const battle = run.deploy(ids)
  app.innerHTML = '<div id="viewport"></div>'
  const viewport = document.getElementById('viewport') as HTMLDivElement
  battleHandle = mountBattleView(viewport, battle, {
    headerHTML: header,
    // Live level/XP for unit tooltips, read from the roster entry that owns
    // this exact unit instance (updates as it evolves mid-battle).
    progressFor: (unit) => {
      const entry = run.roster.find((e) => e.unit === unit)
      if (!entry) return undefined
      const p = levelProgress(entry)
      return { level: entry.level, into: p ? p.into : 0, span: p ? p.span : null }
    },
    onEnd: () => {
      run.finishBattle()
      renderRun()
    },
  })
}

function renderEnd(): void {
  battleHandle?.destroy()
  battleHandle = null
  app.innerHTML = endHTML(run)
  wireChrome()
}

function wireChrome(): void {
  const seedInput = document.getElementById('runSeed') as HTMLInputElement | null
  document.getElementById('newRunBtn')?.addEventListener('click', () => {
    const seed = seedInput && seedInput.value !== '' ? Number(seedInput.value) : Math.floor(Math.random() * 1_000_000)
    startRun(seed)
  })
}

startRun(2026)
