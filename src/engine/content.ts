// Loads and validates the JSON content bundle into typed, id-indexed defs, and
// instantiates unit templates into live units. Validation is deliberately
// hand-rolled (no schema dependency) and loud: bad content fails fast at load
// with a specific message, rather than surfacing as a mysterious NaN mid-battle.
//
// loadContent is pure — it takes already-parsed arrays, not file paths — so the
// engine never learns where content comes from. Wiring the bundled JSON files
// lives at the bottom, isolated from the validator so tests can feed fixtures.

import type {
  AbilityDef,
  Content,
  TerrainDef,
  TriggerType,
  Unit,
  UnitDef,
} from './types'

import terrainJson from '../../data/terrain.json'
import abilitiesJson from '../../data/abilities.json'
import unitsJson from '../../data/units.json'

const TRIGGERS: ReadonlySet<TriggerType> = new Set<TriggerType>([
  'on_gain',
  'on_kill',
  'on_move',
  'on_turn_start',
  'on_attack',
  'on_take_damage',
  'on_adjacent',
  'on_level_up',
])

// --- tiny validation helpers -------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function req(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`content: ${msg}`)
}

function indexById<T extends { id: string }>(items: T[], kind: string): Record<string, T> {
  const out: Record<string, T> = {}
  for (const item of items) {
    req(!(item.id in out), `duplicate ${kind} id "${item.id}"`)
    out[item.id] = item
  }
  return out
}

// --- per-kind validators (raw JSON -> typed def) -----------------------------

function parseTerrain(raw: unknown): TerrainDef {
  req(isObj(raw), 'terrain entry is not an object')
  const t = raw as Record<string, unknown>
  req(typeof t.id === 'string', 'terrain missing string id')
  for (const k of ['name', 'color'] as const)
    req(typeof t[k] === 'string', `terrain "${t.id}" missing ${k}`)
  for (const k of ['moveCost', 'defBonus', 'avoidBonus'] as const)
    req(typeof t[k] === 'number', `terrain "${t.id}" missing numeric ${k}`)
  req(typeof t.passable === 'boolean', `terrain "${t.id}" missing passable`)
  return {
    id: t.id as string,
    name: t.name as string,
    color: t.color as string,
    moveCost: t.moveCost as number,
    defBonus: t.defBonus as number,
    avoidBonus: t.avoidBonus as number,
    passable: t.passable as boolean,
  }
}

function parseAbility(raw: unknown): AbilityDef {
  req(isObj(raw), 'ability entry is not an object')
  const a = raw as Record<string, unknown>
  req(typeof a.id === 'string', 'ability missing string id')
  req(typeof a.name === 'string', `ability "${a.id}" missing name`)
  req(
    typeof a.trigger === 'string' && TRIGGERS.has(a.trigger as TriggerType),
    `ability "${a.id}" has unknown trigger "${String(a.trigger)}"`,
  )
  req(Array.isArray(a.effects), `ability "${a.id}" missing effects array`)
  for (const e of a.effects as unknown[])
    req(isObj(e) && typeof e.type === 'string', `ability "${a.id}" has a malformed effect`)
  if (a.condition !== undefined)
    req(
      isObj(a.condition) && typeof a.condition.type === 'string',
      `ability "${a.id}" has a malformed condition`,
    )
  return a as unknown as AbilityDef
}

function parseUnit(raw: unknown, abilities: Record<string, AbilityDef>): UnitDef {
  req(isObj(raw), 'unit entry is not an object')
  const u = raw as Record<string, unknown>
  req(typeof u.id === 'string', 'unit missing string id')
  req(typeof u.name === 'string', `unit "${u.id}" missing name`)
  req(typeof u.glyph === 'string', `unit "${u.id}" missing glyph`)
  req(u.faction === 'player' || u.faction === 'enemy', `unit "${u.id}" bad faction`)
  req(u.tier === undefined || u.tier === 'named' || u.tier === 'unnamed',
    `unit "${u.id}" bad tier "${String(u.tier)}"`)
  req(isObj(u.stats), `unit "${u.id}" missing stats`)
  const s = u.stats as Record<string, unknown>
  for (const k of ['maxHp', 'atk', 'def', 'spd', 'skl'] as const)
    req(typeof s[k] === 'number', `unit "${u.id}" missing stat ${k}`)
  req(isObj(u.movement) && typeof (u.movement as any).points === 'number',
    `unit "${u.id}" missing movement.points`)
  req(isObj(u.attack), `unit "${u.id}" missing attack`)
  const at = u.attack as Record<string, unknown>
  for (const k of ['minRange', 'maxRange', 'hit', 'crit'] as const)
    req(typeof at[k] === 'number', `unit "${u.id}" missing attack.${k}`)
  req(Array.isArray(u.abilities), `unit "${u.id}" missing abilities array`)
  for (const id of u.abilities as unknown[])
    req(typeof id === 'string' && id in abilities,
      `unit "${u.id}" references unknown ability "${String(id)}"`)
  return u as unknown as UnitDef
}

/** Validate + index already-parsed content arrays. Pure; throws on bad data. */
export function loadContent(
  rawTerrain: unknown[],
  rawAbilities: unknown[],
  rawUnits: unknown[],
): Content {
  const terrain = indexById(rawTerrain.map(parseTerrain), 'terrain')
  const abilities = indexById(rawAbilities.map(parseAbility), 'ability')
  const units = indexById(rawUnits.map((u) => parseUnit(u, abilities)), 'unit')
  return { terrain, abilities, units }
}

// --- instantiation -----------------------------------------------------------

/**
 * Build a live Unit from a template. Stats/movement/attack are deep-copied so
 * each instance owns mutable state (evolution edits stats per-unit); ability
 * entries are references to the shared, immutable library defs. Position is a
 * placeholder — battle setup places units on the board.
 *
 * Note: any starting ability with an `on_gain` trigger is NOT applied here;
 * that is the ability system's job, run by battle setup once it exists, so the
 * content layer stays free of rules logic.
 */
export function instantiateUnit(content: Content, defId: string, instanceId: string): Unit {
  const def = content.units[defId]
  if (!def) throw new Error(`instantiateUnit: unknown unit def "${defId}"`)
  return {
    id: instanceId,
    defId: def.id,
    name: def.name,
    faction: def.faction,
    tier: def.tier ?? 'unnamed',
    glyph: def.glyph,
    stats: { ...def.stats },
    hp: def.stats.maxHp,
    pos: { x: 0, y: 0 },
    movement: { points: def.movement.points, ...(def.movement.terrainCosts
      ? { terrainCosts: { ...def.movement.terrainCosts } } : {}) },
    attack: { ...def.attack },
    abilities: def.abilities.map((id) => content.abilities[id]),
    hasMoved: false,
    hasActed: false,
    alive: true,
    kills: 0,
  }
}

/** The bundled default content, validated at import. */
export const defaultContent: Content = loadContent(
  terrainJson as unknown[],
  abilitiesJson as unknown[],
  unitsJson as unknown[],
)
