// Leveling math — pure, no engine or RNG. XP thresholds are cumulative; the
// escalating gaps mean roughly one level per battle early, slowing later.
// Crossing a threshold is what the run layer turns into an evolution.

export const LEVEL_THRESHOLDS = [0, 100, 250, 450, 700]
export const MAX_LEVEL = LEVEL_THRESHOLDS.length // 5

/** Highest level whose cumulative XP requirement is met. */
export function levelForXp(xp: number): number {
  let level = 1
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1
  return level
}

/** Cumulative XP required to reach a level (clamped to the table). */
export function xpForLevel(level: number): number {
  return LEVEL_THRESHOLDS[Math.min(Math.max(level, 1), MAX_LEVEL) - 1]
}

export interface Leveled {
  xp: number
  level: number
}

/**
 * Add XP and drive `onLevelUp` once per level actually gained (a big award can
 * cross several thresholds at once). Mutates `entry`.
 */
export function grantXp(entry: Leveled, amount: number, onLevelUp: (newLevel: number) => void): void {
  if (amount <= 0) return
  entry.xp += amount
  const target = levelForXp(entry.xp)
  while (entry.level < target) {
    entry.level += 1
    onLevelUp(entry.level)
  }
}

/** Progress toward the next level, for a UI bar. Returns null at max level. */
export function levelProgress(entry: Leveled): { into: number; span: number } | null {
  if (entry.level >= MAX_LEVEL) return null
  const floor = xpForLevel(entry.level)
  const next = xpForLevel(entry.level + 1)
  return { into: entry.xp - floor, span: next - floor }
}
