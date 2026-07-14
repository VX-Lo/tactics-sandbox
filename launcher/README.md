# Handoff: Launcher Screen

## Overview
New front-door screen for the game. Sits before Campaign / Quick Battle / the
single-skirmish sandbox — currently the project has no such screen; `index.html`
drops straight into a Run. This gives Lo (and only Lo — this isn't a public
site) a proper menu.

## About these files
`launcher.html` / `launcher.css` / `launcher.js` are a **design reference**,
written in this repo's actual idiom (plain HTML, CSS custom properties,
a small vanilla controller module) — not a framework export. They should be
close to directly usable, following the same shape as `src/ui/main.ts` /
`campaign-main.ts`: an entry HTML file + a controller module that mounts into
it and wires clicks. Suggested landing spot:
- `launcher.html` (new Vite entry, add to `vite.config.ts` → `build.rollupOptions.input`)
- `src/ui/launcher-main.ts` (port of `launcher.js`)
- merge `launcher.css` rules into `src/ui/style.css` (or keep as its own
  imported file — either fits the existing pattern)

**Open question for whoever wires this up:** where does this screen actually
sit relative to `index.html` (the full Run) and `campaign.html` (the
strategic map)? The menu below assumes "Campaign" routes to `campaign.html`
and "Quick Battle" routes to `battle.html`, but doesn't address what happens
to the existing Run flow (`index.html`) — that's a product call, not a style
one. Flagging rather than deciding.

## Load-bearing hooks
Everything is styled via classes, freely restylable. The `data-hook`
attributes are the only things a controller should ever query — keep these
names stable; rename classes all you want.

- `data-hook="nav-campaign"` — click target. Intent: enter Campaign
  (`campaign.html`). Currently a bare button, no handler wired.
- `data-hook="nav-quick-battle"` — click target. Intent: enter the single
  skirmish sandbox (`battle.html`). No handler wired.
- `data-hook="nav-tools"` — click target. Intent: TBD — no tools/settings
  screen exists yet in the repo. Wire once one does; leave as a no-op or
  disabled state until then.
- `data-hook="wordmark"` — text content only, no behavior. Swap the string
  when the title is finalized (see below).
- `data-hook="freq-value"` — text content updated by `launcher.js`'s ticker
  (cosmetic only, see Animation notes). Safe to delete the ticker and hardcode
  a value if you'd rather not carry the interval.
- `data-hook="snowfield"` — container `launcher.js` populates with particle
  elements at runtime. Purely decorative.

## Title
**Not final.** Working title is currently "Dead Air"; other candidates
in rotation: Actium, Skywave, Driftlands, Static Frontier. Whoever sets the
final title just edits the `data-hook="wordmark"` text — no other code
depends on the string.

## Design tokens
```
--launcher-bg-top:    oklch(17% 0.02 250)
--launcher-bg-mid:    oklch(13% 0.018 248)
--launcher-bg-bottom: oklch(10% 0.015 244)
--launcher-ink:       oklch(92% 0.01 250)   /* wordmark uses #FFFFFFB2 over this, intentionally dimmed */
--launcher-ink-dim:   oklch(60% 0.02 250)
--launcher-ink-dimmer:oklch(55% 0.02 250)

--launcher-accent-ember: #D9A15B   /* active accent — radio-dial amber */
--launcher-accent-frost: #93B7C9   /* reserved, not currently used */
--launcher-accent-moss:  #8FA97E   /* reserved, not currently used */
```
**Keep all three accents defined even though only ember is active right
now** — they're deliberately built to the same lightness/chroma (just
rotated hue) so any of them drops in cleanly later for alt states, factions,
or a theme switch. Don't prune the unused two.

Type: IBM Plex Sans (headings/wordmark) + IBM Plex Mono (labels, status,
nav index numbers), loaded from Google Fonts. This is a deliberate departure
from the in-game UI's system-monospace look — the launcher is meant to read
as more crafted than the utilitarian battle/campaign screens. Flag if that
split isn't wanted.

## Animation notes (all decorative, no game-state coupling)
- Snowfall: ~30 particles, falling top→bottom over 9–19s, opacity 0.15–0.45,
  randomized per particle in `launcher.js`. Regenerate freely.
- Scanline overlay: repeating 4px gradient, slow vertical drift, blended at
  low opacity — never fully hides content.
- Signal bars + frequency readout: 4 bars pulse on staggered delays; the
  number beside them drifts randomly in an 88–108 band every ~2.2s via
  `setInterval`, matching the "cosmetic randomness only" pattern already used
  in `main.ts` / `campaign-main.ts`.
- Ridgeline silhouettes + two floating-island shapes: static/slow-drift CSS
  shapes, no JS.
- All motion is muted by design (low opacity, slow timing) — intentional,
  not a placeholder for something bigger.

## Files
- `launcher.html` — markup
- `launcher.css` — all styles (uses the token list above)
- `launcher.js` — snow particle generation + frequency ticker; nav buttons
  currently just `console.log` their intent — replace with real navigation
