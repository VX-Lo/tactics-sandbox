// Campaign controller: mounts the strategic map view over a Campaign, wires the
// player's orders (click a node to travel; Capture / Wait buttons), and re-renders
// after each turn. It owns no rules — every order and query goes to the Campaign.

import './style.css'
import { Campaign } from '../campaign/campaign'
import { defaultWorld } from '../campaign/world'
import { animateCampaignUI, campaignMapSVG, campaignSidebarHTML } from './campaign-view'

const app = document.getElementById('app')!
let campaign: Campaign

function render(): void {
  const player = campaign.playerParty()
  const canCapture = campaign.canCaptureHere()
  app.innerHTML = `
    <header class="topbar">
      <h1>Deepwood — Campaign</h1>
      <span class="turn">Turn ${campaign.turnCount} · Clock ${campaign.clock}</span>
      <span class="spacer"></span>
      <div class="controls">
        <button id="captureBtn"${canCapture ? '' : ' disabled'}>Capture</button>
        <button id="waitBtn"${player ? '' : ' disabled'}>Wait a turn</button>
        <label class="muted">seed <input id="campSeed" value="${campaign.seed}" /></label>
        <button id="newBtn">New</button>
      </div>
    </header>
    <div class="run-screen">
      <section class="camp-mapcol">${campaignMapSVG(campaign)}</section>
      <section class="camp-side">${campaignSidebarHTML(campaign)}</section>
    </div>`
  animateCampaignUI(app, campaign) // presentation only — tweens the numbers/bars just inserted

  app.querySelectorAll<SVGElement>('.camp-node').forEach((el) =>
    el.addEventListener('click', () => travelTo(el.dataset.node!)),
  )
  app.querySelector('#captureBtn')!.addEventListener('click', () => {
    if (campaign.canCaptureHere()) campaign.turn({ op: 'capture' })
    render()
  })
  app.querySelector('#waitBtn')!.addEventListener('click', () => {
    campaign.turn({ op: 'wait' })
    render()
  })
  app.querySelector('#newBtn')!.addEventListener('click', () => {
    const raw = (app.querySelector('#campSeed') as HTMLInputElement).value
    // The only sanctioned Math.random use: choosing WHICH deterministic seed to play.
    const seed = raw.trim() === '' ? Math.floor(Math.random() * 1e9) : Number(raw) >>> 0
    startCampaign(seed)
  })
}

// Travel to a node: advance one turn per edge until the player arrives (or is
// removed / stops making progress). The rival acts on every turn, so the map can
// change under you as you march.
function travelTo(dest: string): void {
  let guard = 0
  while (guard++ < 200) {
    const player = campaign.playerParty()
    if (!player || player.pos === dest) break
    const before = player.pos
    campaign.turn({ op: 'travel', dest })
    const after = campaign.playerParty()?.pos
    if (after === before) break // unreachable / no progress
  }
  render()
}

function startCampaign(seed: number): void {
  campaign = new Campaign(defaultWorld, seed)
  render()
}

startCampaign(2026)
