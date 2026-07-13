// Roster-screen and end-screen rendering for the run layer. Pure
// (run -> HTML); the run controller owns state and wiring. Shows survivors with
// their level/XP and evolutions, the fallen, and the three encounter choices.

import type { Run, RosterEntry } from '../run/run'
import type { Encounter } from '../run/encounters'
import { DIFFICULTIES } from '../run/encounters'
import { BIOMES } from '../run/biomes'
import { runContent } from '../run/content'
import { levelProgress } from '../run/progression'
import type { LogEntry } from '../engine/types'

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function abilityList(entry: RosterEntry): string {
  const learned = entry.unit.abilities
    .filter((a) => a.id !== 'evolve_on_level')
    .map((a) => `<li><span class="ab-name">${esc(a.name)}</span></li>`)
    .join('')
  return learned || '<li class="muted">no evolutions yet</li>'
}

function unitCardHTML(entry: RosterEntry): string {
  const u = entry.unit
  const p = levelProgress(entry)
  const pct = p ? Math.round((p.into / p.span) * 100) : 100
  const xpText = p ? `${p.into}/${p.span} XP` : 'MAX'
  const s = u.stats
  return `
    <div class="unit-card">
      <div class="uc-head">
        <span class="glyph player">${esc(u.glyph)}</span>
        <span class="unit-name player">${esc(u.name)}</span>
        ${u.tier === 'levy' ? '<span class="tier-tag levy">Levy</span>' : ''}
        <span class="level">Lv ${entry.level}</span>
      </div>
      <div class="xpbar" title="${xpText}"><span style="width:${pct}%"></span></div>
      <div class="uc-stats muted">
        <span class="${u.hp < s.maxHp ? 'wounded' : ''}">HP ${u.hp}/${s.maxHp}</span> · Atk ${s.atk} · Def ${s.def} · Spd ${s.spd} · ${u.kills} kills
      </div>
      <ul class="abilities">${abilityList(entry)}</ul>
    </div>`
}

// A roster card as a deploy/bench toggle for the deployment screen.
function deployCardHTML(entry: RosterEntry, selected: boolean): string {
  const u = entry.unit
  const p = levelProgress(entry)
  const pct = p ? Math.round((p.into / p.span) * 100) : 100
  const s = u.stats
  const badge = selected
    ? '<span class="deploy-badge on">Deployed</span>'
    : '<span class="deploy-badge">Benched</span>'
  return `
    <div class="unit-card deploy-card${selected ? ' selected' : ''}" role="button" tabindex="0" aria-pressed="${selected}" data-deploy-toggle="${esc(u.id)}">
      <div class="uc-head">
        <span class="glyph player">${esc(u.glyph)}</span>
        <span class="unit-name player">${esc(u.name)}</span>
        ${u.tier === 'levy' ? '<span class="tier-tag levy">Levy</span>' : ''}
        <span class="level">Lv ${entry.level}</span>
        ${badge}
      </div>
      <div class="xpbar"><span style="width:${pct}%"></span></div>
      <div class="uc-stats muted"><span class="${u.hp < s.maxHp ? 'wounded' : ''}">HP ${u.hp}/${s.maxHp}</span> · Atk ${s.atk} · Def ${s.def} · Spd ${s.spd}</div>
      <ul class="abilities">${abilityList(entry)}</ul>
    </div>`
}

function fallenHTML(entry: RosterEntry): string {
  return `<div class="fallen-item"><span class="glyph dead">${esc(entry.unit.glyph)}</span> ${esc(entry.unit.name)} <span class="muted">(Lv ${entry.level})</span></div>`
}

function composition(enc: Encounter): string {
  const counts = new Map<string, number>()
  for (const d of enc.enemyRoster) counts.set(d, (counts.get(d) ?? 0) + 1)
  return [...counts.entries()]
    .map(([d, n]) => `<span class="foe">${esc(runContent.units[d].glyph)}×${n}</span>`)
    .join(' ')
}

function encounterCardHTML(enc: Encounter, index: number): string {
  const biome = BIOMES[enc.biome]
  const diff = DIFFICULTIES[enc.difficulty]
  return `
    <button class="encounter-card" data-encounter="${index}">
      <div class="ec-head"><span class="ec-diff diff-${enc.difficulty}">${diff.label}</span><span class="ec-biome">${esc(biome.label)}</span></div>
      <div class="muted ec-blurb">${esc(biome.blurb)}</div>
      <div class="ec-foes">${composition(enc)} <span class="muted">(${enc.enemyRoster.length} foes)</span></div>
      <div class="ec-reward">+${enc.xpReward} clear XP · more per kill</div>
    </button>`
}

function logLines(log: LogEntry[], limit = 16): string {
  return log
    .slice(-limit)
    .map((e) => `<div class="entry k-${e.kind}">${esc(e.message)}</div>`)
    .join('')
}

function chrome(run: Run, title: string): string {
  return `
    <header class="topbar">
      <h1>Elves of the Deepwood</h1>
      <span class="turn">${title}</span>
      <span class="spacer"></span>
      <div class="controls">
        <label class="muted">seed <input id="runSeed" value="${run.seed}" /></label>
        <button id="newRunBtn">New Run</button>
        <a class="muted linklike" href="/battle.html">▶ Single skirmish</a>
      </div>
    </header>`
}

export function rosterHTML(run: Run): string {
  return `
    ${chrome(run, `Battle ${run.battleIndex + 1} of ${run.totalBattles}`)}
    <div class="run-screen">
      <section class="roster-col">
        <h2 class="section">Your Elves</h2>
        <div class="roster-grid">${run.roster.map(unitCardHTML).join('')}</div>
        ${
          run.fallen.length
            ? `<h2 class="section loss">The Fallen</h2><div class="fallen-list">${run.fallen.map(fallenHTML).join('')}</div>`
            : ''
        }
      </section>
      <section class="encounter-col">
        <h2 class="section">Choose your next battle</h2>
        <div class="encounter-cards">${run.encounters.map(encounterCardHTML).join('')}</div>
        <div class="card"><h2>Chronicle</h2><div id="runlog">${logLines(run.log)}</div></div>
      </section>
    </div>`
}

export function deployHTML(run: Run, selected: Set<string>): string {
  const enc = run.pendingEncounter
  if (!enc) return rosterHTML(run) // defensive; controller only calls this in 'deploy'
  const biome = BIOMES[enc.biome]
  const diff = DIFFICULTIES[enc.difficulty]
  const cap = run.maxDeployable()
  const count = selected.size
  const canDeploy = count >= 1 && count <= cap
  return `
    ${chrome(run, `Battle ${run.battleIndex + 1} of ${run.totalBattles} · Deployment`)}
    <div class="run-screen">
      <section class="roster-col">
        <h2 class="section">Field up to ${cap} <span class="muted">— ${count}/${cap} selected (tap to toggle)</span></h2>
        <div class="roster-grid">${run.roster.map((e) => deployCardHTML(e, selected.has(e.unit.id))).join('')}</div>
        ${
          run.fallen.length
            ? `<h2 class="section loss">The Fallen</h2><div class="fallen-list">${run.fallen.map(fallenHTML).join('')}</div>`
            : ''
        }
      </section>
      <section class="encounter-col">
        <h2 class="section">The battle ahead</h2>
        <div class="card">
          <div class="ec-head"><span class="ec-diff diff-${enc.difficulty}">${diff.label}</span><span class="ec-biome">${esc(biome.label)}</span></div>
          <div class="muted ec-blurb">${esc(biome.blurb)}</div>
          <div class="ec-foes">${composition(enc)} <span class="muted">(${enc.enemyRoster.length} foes)</span></div>
          <div class="ec-reward">+${enc.xpReward} clear XP · more per kill</div>
        </div>
        <div class="deploy-actions">
          <button id="deployBtn"${canDeploy ? '' : ' disabled'}>Send ${count} into battle →</button>
          <button id="backBtn" class="ghost">← Back</button>
        </div>
        <p class="muted deploy-hint">Benched elves earn no XP and take no damage — but sit out entirely.
        Kaede's Mend Aura only helps if she is fielded.</p>
      </section>
    </div>`
}

export function endHTML(run: Run): string {
  const won = run.phase === 'won'
  const banner = won
    ? '<span class="outcome win">The Deepwood endures.</span>'
    : '<span class="outcome loss">The forest goes dark.</span>'
  const survivors = run.roster.length
    ? `<div class="roster-grid">${run.roster.map(unitCardHTML).join('')}</div>`
    : '<div class="muted">No elf survived.</div>'
  return `
    ${chrome(run, won ? 'Run complete' : 'Run ended')}
    <div class="run-screen end">
      <section class="roster-col">
        <h2 class="section">${banner}</h2>
        ${survivors}
        ${run.fallen.length ? `<h2 class="section loss">The Fallen</h2><div class="fallen-list">${run.fallen.map(fallenHTML).join('')}</div>` : ''}
      </section>
      <section class="encounter-col">
        <div class="card"><h2>Chronicle</h2><div id="runlog">${logLines(run.log, 40)}</div></div>
      </section>
    </div>`
}
