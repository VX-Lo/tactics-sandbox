// Presentation for the campaign layer: a pure (Campaign -> HTML) renderer. Like
// the battle view, it computes no rules — it only reads the campaign's public
// queries and draws the node-graph map, the parties, the clock, and the running
// count of player-owned settlements (the primitive territory-progress signal).

import type { Campaign } from '../campaign/campaign'
import { PLAYER } from '../campaign/types'

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const W = 1000
const H = 600
const sx = (x: number) => (0.06 + x * 0.88) * W
const sy = (y: number) => (0.08 + y * 0.84) * H

export function campaignMapSVG(c: Campaign): string {
  const nodeById = (id: string) => c.nodeOf(id)!
  const parts: string[] = []

  // Edges first (under the nodes).
  for (const e of c.world.edges) {
    const a = nodeById(e.a)
    const b = nodeById(e.b)
    const mx = (sx(a.x) + sx(b.x)) / 2
    const my = (sy(a.y) + sy(b.y)) / 2
    parts.push(
      `<line x1="${sx(a.x)}" y1="${sy(a.y)}" x2="${sx(b.x)}" y2="${sy(b.y)}" stroke="#39424a" stroke-width="2" />`,
      `<text x="${mx}" y="${my - 4}" fill="#6b7480" font-size="12" text-anchor="middle">${e.cost}</text>`,
    )
  }

  // Party markers, so we can ring the nodes they occupy.
  const player = c.playerParty()
  const rival = c.rivalParty()

  for (const n of c.world.nodes) {
    const cx = sx(n.x)
    const cy = sy(n.y)
    if (n.kind === 'waypoint') {
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="7" fill="#2a3138" stroke="#4a545c" stroke-width="2" class="camp-node" data-node="${esc(n.id)}" />`,
        `<text x="${cx}" y="${cy + 24}" fill="#6b7480" font-size="12" text-anchor="middle">${esc(n.name)}</text>`,
      )
      continue
    }
    const owner = c.ownerOf(n.id)!
    const color = c.factionColor(owner)
    const ownedByPlayer = owner === PLAYER
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="20" fill="${color}" fill-opacity="0.85" stroke="${ownedByPlayer ? '#fff' : '#101418'}" stroke-width="${ownedByPlayer ? 3 : 2}" class="camp-node camp-settlement" data-node="${esc(n.id)}" />`,
      `<text x="${cx}" y="${cy + 5}" fill="#101418" font-size="13" font-weight="bold" text-anchor="middle" pointer-events="none">${n.defense}</text>`,
      `<text x="${cx}" y="${cy + 38}" fill="#cfd4d9" font-size="13" text-anchor="middle" pointer-events="none">${esc(n.name)}</text>`,
    )
  }

  // Draw parties on top: player ringed above its node, rival below, so co-located
  // parties stay legible.
  const drawParty = (pos: string, label: string, color: string, dy: number) => {
    const n = nodeById(pos)
    const cx = sx(n.x)
    const cy = sy(n.y) + dy
    return (
      `<circle cx="${cx}" cy="${cy}" r="11" fill="#14181c" stroke="${color}" stroke-width="3" pointer-events="none" />` +
      `<text x="${cx}" y="${cy + 4}" fill="${color}" font-size="12" font-weight="bold" text-anchor="middle" pointer-events="none">${label}</text>`
    )
  }
  if (player) parts.push(drawParty(player.pos, 'P', c.factionColor(player.faction), -30))
  if (rival) parts.push(drawParty(rival.pos, 'R', c.factionColor(rival.faction), 30))

  return `<svg viewBox="0 0 ${W} ${H}" class="camp-map" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

export function campaignSidebarHTML(c: Campaign): string {
  const player = c.playerParty()
  const rival = c.rivalParty()
  const factionTally = c.world.factions
    .map((f) => `<div><span class="camp-swatch" style="background:${f.color}"></span>${esc(f.name)} — ${c.ownedCount(f.id)}</div>`)
    .join('')
  const partyLine = (label: string, p: ReturnType<Campaign['playerParty']>) =>
    p
      ? `<div>${label}: at <b>${esc(c.nodeOf(p.pos)!.name)}</b> · strength <b>${p.strength}</b></div>`
      : `<div class="muted">${label}: destroyed</div>`
  const events = c.events
    .slice(-12)
    .map((e) => `<div class="entry k-${e.kind}">T${e.turn}: ${esc(e.message)}</div>`)
    .join('')

  const res = c.resourcesOf(PLAYER)
  const roster = c.rosterOf(PLAYER)
  const tierCount = (t: string) => roster.filter((u) => u.tier === t && !u.mia && u.debt === 0).length
  const miaCount = roster.filter((u) => u.mia).length
  const debtCount = roster.filter((u) => u.debt > 0).length

  return `
    <div class="card">
      <h2>Territory</h2>
      <div class="camp-owned">You hold <b>${c.ownedCount(PLAYER)}</b> of ${c.world.nodes.filter((n) => n.kind === 'settlement').length} settlements</div>
      ${factionTally}
    </div>
    <div class="card">
      <h2>Economy</h2>
      <div>Scrip: <b>${res.scrip}</b> &middot; Stores: <b>${res.stores}</b></div>
      <div class="muted">Roster: ${tierCount('levy')} levy, ${tierCount('supporting')} supporting, ${tierCount('named')} named${miaCount ? `, ${miaCount} MIA` : ''}${debtCount ? `, ${debtCount} in debt` : ''}</div>
    </div>
    <div class="card">
      <h2>Parties</h2>
      ${partyLine('You', player)}
      ${partyLine('Rival', rival)}
    </div>
    <div class="card"><h2>Chronicle</h2><div id="camplog">${events || '<span class="muted">The map is quiet.</span>'}</div></div>
    <div class="card"><h2>How to play</h2><div class="muted">Click a node to travel (time passes; the rival moves each turn). Capture the settlement you stand on. Number in a node = its defense; bring more strength than that to win.</div></div>`
}
