// Launcher controller. Two jobs: (1) generate the cosmetic snow/signal
// ambience, (2) wire the three menu buttons to real navigation. Job 1 is
// presentation-only, same spirit as animateCampaignUI in campaign-view.ts.
// Job 2 is stubbed — see README for the open routing question.

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

// Cosmetic drift only — same "UI-only randomness" rule as main.ts's seed
// picker. Doesn't touch any game state.
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

function wireNav(): void {
  document.querySelector('[data-hook="nav-campaign"]')?.addEventListener('click', () => {
    // TODO: route to campaign.html once the launcher's place in the flow is decided
    console.log('[launcher] Campaign selected')
  })
  document.querySelector('[data-hook="nav-quick-battle"]')?.addEventListener('click', () => {
    // TODO: route to battle.html
    console.log('[launcher] Quick Battle selected')
  })
  document.querySelector('[data-hook="nav-tools"]')?.addEventListener('click', () => {
    // TODO: no tools screen exists yet
    console.log('[launcher] Tools selected')
  })
}

mountSnow()
mountFrequencyTicker()
wireNav()
