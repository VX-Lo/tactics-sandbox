// The run's content variant. XP replaces on-kill as the evolution trigger, so
// the elves carry `evolve_on_level` (trigger on_level_up) instead of
// `evolve_on_kill` — the SAME grant+rename effects, hung off a different
// trigger. Everything else is the engine's default content.
//
// Building a variant here (rather than editing data/*.json) keeps the engine's
// defaultContent and its tests untouched: the run just feeds Battle different
// data, exactly as the injectable-content seam intends.

import { defaultContent } from '../engine/content'
import type { AbilityDef, Content, UnitDef } from '../engine/types'

const EVOLVE_ON_KILL = 'evolve_on_kill'
const EVOLVE_ON_LEVEL = 'evolve_on_level'

// Same effects as the original evolve ability (grant a random ability + append
// an epithet); only the trigger changes.
const evolveOnLevel: AbilityDef = {
  id: EVOLVE_ON_LEVEL,
  name: 'Blossoming',
  description: 'On gaining a level, learn a new ability and take a new name.',
  trigger: 'on_level_up',
  effects: defaultContent.abilities[EVOLVE_ON_KILL].effects,
}

function retriggerEvolution(def: UnitDef): UnitDef {
  if (!def.abilities.includes(EVOLVE_ON_KILL)) return def
  return {
    ...def,
    abilities: def.abilities.map((id) => (id === EVOLVE_ON_KILL ? EVOLVE_ON_LEVEL : id)),
  }
}

const units: Record<string, UnitDef> = {}
for (const [id, def] of Object.entries(defaultContent.units)) units[id] = retriggerEvolution(def)

/** Content used for every battle in a run: elves evolve on level-up. */
export const runContent: Content = {
  terrain: defaultContent.terrain,
  abilities: { ...defaultContent.abilities, [EVOLVE_ON_LEVEL]: evolveOnLevel },
  units,
}
