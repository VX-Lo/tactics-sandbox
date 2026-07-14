// Presentation-only number tweening. Nothing here reads or writes campaign
// state — it only smooths how already-computed values are DISPLAYED between
// renders, so a state delta reads as motion instead of a jump-cut. The
// campaign view fully rebuilds its DOM on every render() (see
// campaign-main.ts), so elements don't persist across ticks — tweens are
// keyed by a caller-chosen string id and remembered here in module state
// (not on the DOM node), so a freshly-created element can still resume
// mid-value. If a new tick fires before a tween finishes, it simply restarts
// from the last COMMITTED value (snap-and-restart, no queuing) — this is
// flavor, not simulation.
//
// requestAnimationFrame/performance.now() here are frame timing for the
// renderer, not game state — they never feed the campaign's seeded PRNG or
// anything replayed. Distinct from the determinism contract's wall-clock ban.

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

const lastValues = new Map<string, number>()
const generation = new Map<string, number>()

function runTween(key: string, from: number, to: number, duration: number, onFrame: (value: number) => void): void {
  const gen = (generation.get(key) ?? 0) + 1
  generation.set(key, gen)
  const start = performance.now()
  const step = (now: number) => {
    if (generation.get(key) !== gen) return // superseded by a newer tween for this key
    const t = Math.min(1, (now - start) / duration)
    onFrame(from + (to - from) * easeOutCubic(t))
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/**
 * Animate `el`'s text content from this key's last known value to `target`.
 * First sighting of a key (or an unchanged value) snaps instead of tweening —
 * there's nothing to animate from yet.
 */
export function tweenText(
  key: string,
  el: Element | null,
  target: number,
  format: (n: number) => string = (n) => String(Math.round(n)),
  duration = 400,
): void {
  if (!el) return
  const from = lastValues.get(key) ?? target
  lastValues.set(key, target)
  if (from === target) {
    el.textContent = format(target)
    return
  }
  runTween(key, from, target, duration, (v) => {
    el.textContent = format(v)
  })
}

/** Same idea, but drives a 0-100 CSS width percentage — a filling/draining bar. */
export function tweenBarWidth(key: string, el: HTMLElement | null, targetPct: number, duration = 400): void {
  if (!el) return
  const target = Math.max(0, Math.min(100, targetPct))
  const from = lastValues.get(key) ?? target
  lastValues.set(key, target)
  if (from === target) {
    el.style.width = `${target}%`
    return
  }
  runTween(key, from, target, duration, (v) => {
    el.style.width = `${v}%`
  })
}
