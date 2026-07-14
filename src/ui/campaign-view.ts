// Presentation for the campaign layer: a pure (Campaign -> HTML) renderer. Like
// the battle view, it computes no rules — it only reads the campaign's public
// queries and draws the node-graph map, the parties, the clock, and the running
// count of player-owned settlements (the primitive territory-progress signal).
//
// Animation note: campaignMapSVG remembers each Campaign's last-seen node
// ownership (below) purely to flag "just captured" for one render's flash —
// display memory, not game state. animateCampaignUI (bottom of file) tweens
// the numbers this module renders as text/bars; call it after inserting the
// HTML this module returns (see campaign-main.ts).

import type { Campaign } from '../campaign/campaign'
import { PLAYER, type NodeId, type Owner } from '../campaign/types'
import { ECONOMY } from '../campaign/economy'
import { describeCampaignLogEvent } from '../campaign/log'
import { tweenBarWidth, tweenText } from './animate'

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const W = 1000
const H = 600
const sx = (x: number) => (0.06 + x * 0.88) * W
const sy = (y: number) => (0.08 + y * 0.84) * H

// Last-rendered owner per settlement, per Campaign instance — enough to flag a
// capture for one flash animation. Keyed by object identity so a fresh
// Campaign (the "New" button) never flashes on its first render.
const lastOwnership = new WeakMap<Campaign, Map<string, string>>()

// How many entries the log renders (newest first, so what just happened is
// visible without scrolling) vs. how many Campaign keeps (see campaign.ts's
// own, larger MAX_LOG_ENTRIES cap — this is just the visible window).
const LOG_VISIBLE_CAP = 20

// Entry count last rendered, per Campaign instance — lets the log flag only
// the entries that are actually NEW this render for a one-shot fade-in,
// instead of replaying the animation on every re-render (same technique as
// lastOwnership above). A fresh Campaign starts with nothing "new".
const lastLogCount = new WeakMap<Campaign, number>()

function renderLogHTML(c: Campaign): string {
  const total = c.events.length
  const prevCount = lastLogCount.get(c) ?? total
  lastLogCount.set(c, total)
  const newCount = Math.max(0, total - prevCount)

  const nodeName = (id: NodeId) => c.nodeOf(id)?.name ?? id
  const factionName = (f: Owner) => c.factionName(f)

  const recent = c.events.slice(-LOG_VISIBLE_CAP) // oldest..newest within the window
  return recent
    .map((e, i) => {
      const isNew = recent.length - 1 - i < newCount // 0 = newest
      const text = describeCampaignLogEvent(e.event, { factionName, nodeName })
      return `<div class="entry k-${e.event.kind}${isNew ? ' log-new' : ''}">T${e.turn}: ${esc(text)}</div>`
    })
    .reverse() // newest first — the point that just happened shouldn't require scrolling to
    .join('')
}

export function campaignMapSVG(c: Campaign): string {
  const nodeById = (id: string) => c.nodeOf(id)!
  const parts: string[] = []
  let prevOwners = lastOwnership.get(c)
  if (!prevOwners) {
    prevOwners = new Map()
    lastOwnership.set(c, prevOwners)
  }

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
    const prevOwner = prevOwners.get(n.id)
    const justCaptured = prevOwner !== undefined && prevOwner !== owner
    prevOwners.set(n.id, owner) // remember for the NEXT render's diff
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="20" fill="${color}" fill-opacity="0.85" stroke="${ownedByPlayer ? '#fff' : '#101418'}" stroke-width="${ownedByPlayer ? 3 : 2}" class="camp-node camp-settlement${justCaptured ? ' just-captured' : ''}" data-node="${esc(n.id)}" />`,
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

// A full Stores bar's worth of "runway" — a presentation choice (how many
// ticks of upkeep a full reserve gauge represents), not new tracked state:
// the bar is just Stores against the roster's own per-tick upkeep cost.
const STORES_GAUGE_RUNWAY_TICKS = 3

/** Player roster tallies, shared by the initial render and animateCampaignUI
 *  so the two never drift out of sync. */
function playerRosterTally(c: Campaign) {
  const roster = c.rosterOf(PLAYER)
  const active = roster.filter((u) => !u.mia)
  return {
    levy: roster.filter((u) => u.tier === 'levy' && !u.mia && u.debt === 0).length,
    supporting: roster.filter((u) => u.tier === 'supporting' && !u.mia && u.debt === 0).length,
    named: roster.filter((u) => u.tier === 'named' && !u.mia && u.debt === 0).length,
    mia: roster.filter((u) => u.mia).length,
    debt: roster.filter((u) => u.debt > 0).length,
    upkeepPerTick: active.reduce((sum, u) => sum + ECONOMY.upkeepCost[u.tier], 0),
  }
}

export function campaignSidebarHTML(c: Campaign): string {
  const player = c.playerParty()
  const rival = c.rivalParty()
  const factionTally = c.world.factions
    .map(
      (f) =>
        `<div><span class="camp-swatch" style="background:${f.color}"></span>${esc(f.name)} — <span id="tally-${esc(f.id)}">${c.ownedCount(f.id)}</span></div>`,
    )
    .join('')
  const partyLine = (label: string, key: string, p: ReturnType<Campaign['playerParty']>) =>
    p
      ? `<div>${label}: at <b>${esc(c.nodeOf(p.pos)!.name)}</b> · strength <b id="party-${key}-str">${p.strength}</b></div>`
      : `<div class="muted">${label}: destroyed</div>`
  const events = renderLogHTML(c)

  const res = c.resourcesOf(PLAYER)
  const tally = playerRosterTally(c)
  const scripPct = Math.min(100, (res.scrip / ECONOMY.captureCost) * 100)
  const storesPct = tally.upkeepPerTick > 0 ? Math.min(100, (res.stores / (tally.upkeepPerTick * STORES_GAUGE_RUNWAY_TICKS)) * 100) : 100

  return `
    <div class="card">
      <h2>Territory</h2>
      <div class="camp-owned">You hold <b id="camp-owned-total">${c.ownedCount(PLAYER)}</b> of ${c.world.nodes.filter((n) => n.kind === 'settlement').length} settlements</div>
      ${factionTally}
    </div>
    <div class="card">
      <h2>Economy</h2>
      <div>Scrip: <b id="econ-scrip">${res.scrip}</b> &middot; Stores: <b id="econ-stores">${res.stores}</b></div>
      <div class="econ-gauge-row"><span class="lbl muted">expansion</span><div class="econ-gauge"><span id="bar-scrip" style="width:${scripPct}%"></span></div></div>
      <div class="econ-gauge-row"><span class="lbl muted">reserve</span><div class="econ-gauge stores"><span id="bar-stores" style="width:${storesPct}%"></span></div></div>
      <div class="muted">Roster: <span id="econ-levy">${tally.levy}</span> levy, <span id="econ-support">${tally.supporting}</span> supporting, <span id="econ-named">${tally.named}</span> named${tally.mia ? `, <span id="econ-mia">${tally.mia}</span> MIA` : ''}${tally.debt ? `, <span id="econ-debt">${tally.debt}</span> in debt` : ''}</div>
    </div>
    <div class="card">
      <h2>Parties</h2>
      ${partyLine('You', 'you', player)}
      ${partyLine('Rival', 'rival', rival)}
    </div>
    <div class="card"><h2>Chronicle</h2><div id="camplog">${events || '<span class="muted">The map is quiet.</span>'}</div></div>
    <div class="card"><h2>How to play</h2><div class="muted">Click a node to travel (time passes; the rival moves each turn). Capture the settlement you stand on. Number in a node = its defense; bring more strength than that to win.</div></div>`
}

/**
 * Tween every number this module renders as text/bars from its previously
 * displayed value to the campaign's current one. Call once, right after
 * inserting the HTML from campaignMapSVG/campaignSidebarHTML into `root`
 * (see campaign-main.ts) — presentation only, no campaign state is touched.
 */
export function animateCampaignUI(root: ParentNode, c: Campaign): void {
  const q = (id: string) => root.querySelector(`#${id}`)
  const qBar = (id: string) => root.querySelector<HTMLElement>(`#${id}`)

  tweenText('camp-owned-total', q('camp-owned-total'), c.ownedCount(PLAYER))
  for (const f of c.world.factions) tweenText(`tally-${f.id}`, q(`tally-${f.id}`), c.ownedCount(f.id))

  const player = c.playerParty()
  const rival = c.rivalParty()
  if (player) tweenText('party-you-str', q('party-you-str'), player.strength)
  if (rival) tweenText('party-rival-str', q('party-rival-str'), rival.strength)

  const res = c.resourcesOf(PLAYER)
  tweenText('econ-scrip', q('econ-scrip'), res.scrip)
  tweenText('econ-stores', q('econ-stores'), res.stores)

  const tally = playerRosterTally(c)
  tweenText('econ-levy', q('econ-levy'), tally.levy)
  tweenText('econ-support', q('econ-support'), tally.supporting)
  tweenText('econ-named', q('econ-named'), tally.named)
  tweenText('econ-mia', q('econ-mia'), tally.mia)
  tweenText('econ-debt', q('econ-debt'), tally.debt)

  const scripPct = Math.min(100, (res.scrip / ECONOMY.captureCost) * 100)
  const storesPct = tally.upkeepPerTick > 0 ? Math.min(100, (res.stores / (tally.upkeepPerTick * STORES_GAUGE_RUNWAY_TICKS)) * 100) : 100
  tweenBarWidth('bar-scrip', qBar('bar-scrip'), scripPct)
  tweenBarWidth('bar-stores', qBar('bar-stores'), storesPct)
}
