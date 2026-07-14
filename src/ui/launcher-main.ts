// Launcher controller (the WIRED port of launcher/launcher.js — Aya's design
// reference). Two jobs: (1) generate the cosmetic snow/signal ambience, (2) wire
// the menu buttons to real navigation. Job 1 is presentation-only, the same
// "UI-only randomness" exception main.ts / campaign-main.ts already use — it
// never touches the seeded simulation, so the determinism contract is untouched.
//
// SHELL<->GAME BOUNDARY: this file queries ONLY the launcher.html data-hooks. It
// knows nothing of game internals — navigation is plain page routing. See the
// contract block in launcher.html for the load-bearing hook names and routing.

import './launcher.css'

const SNOW_COUNT = 30

function mountSnow(): void {
  const field = document.querySelector<HTMLElement>('[data-hook="snowfield"]')
  if (!field) return
  for (let i = 0; i < SNOW_COUNT; i++) {
    const flake = document.createElement('div')
    flake.className = 'launcher-snow'
    const size = 2 + Math.random() * 2
    flake.style.left = `${Math.random() * 100}%`
    flake.style.width = `${size}px`
    flake.style.height = `${size}px`
    flake.style.opacity = String(0.15 + Math.random() * 0.3)
    flake.style.animationDuration = `${9 + Math.random() * 10}s`
    flake.style.animationDelay = `${-(Math.random() * 18)}s`
    field.appendChild(flake)
  }
}

// Cosmetic drift only — same UI-only randomness rule as main.ts's seed picker.
function mountFrequencyTicker(): void {
  const el = document.querySelector<HTMLElement>('[data-hook="freq-value"]')
  if (!el) return
  let freq = 96.4
  setInterval(() => {
    freq += (Math.random() - 0.5) * 1.4
    freq = Math.min(108, Math.max(88, freq))
    el.textContent = freq.toFixed(1)
  }, 2200)
}

// Real navigation: the launcher is the front door; each mode is its own Vite page.
function wireNav(): void {
  const go = (hook: string, href: string) => {
    const btn = document.querySelector<HTMLButtonElement>(`[data-hook="${hook}"]`)
    if (!btn || btn.disabled) return
    btn.addEventListener('click', () => {
      window.location.href = href
    })
  }
  go('nav-campaign', '/campaign.html')
  go('nav-quick-battle', '/battle.html')
  // nav-tools stays a disabled no-op until a tools/settings screen exists.
}

mountSnow()
mountFrequencyTicker()
wireNav()
