// World loading + graph pathfinding. `loadWorld` is pure — it takes already-
// parsed data and validates it into a typed static World plus the initial mutable
// state (ownership, parties). The bundled world file is wired at the bottom,
// isolated from the validator so tests can feed fixtures.
//
// Pathfinding is deterministic Dijkstra over undirected edge costs, with ties
// broken by node id so expansion order never depends on Map/iteration quirks.

import type { Edge, Faction, NodeId, Owner, Party, World, WorldNode } from './types'
import type { EconomyTier, RosterSeed } from './economy'
import worldData from '../../data/world.json'

export interface LoadedWorld {
  world: World
  /** settlement id -> initial owner. Waypoints are never owned. */
  ownership: Map<NodeId, Owner>
  parties: Party[]
  /** Per-faction starting roster that seeds the in-memory RosterPort (see
   *  economy.ts's makeInMemoryRosterPort). A party with no `roster` in the data
   *  gets an empty one — it still gets a resource bank and income, just nothing
   *  to feed. */
  rosterSeeds: RosterSeed[]
}

// --- validation ------------------------------------------------------------

function req(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`world: ${msg}`)
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function loadWorld(raw: unknown): LoadedWorld {
  req(isObj(raw), 'root is not an object')
  const r = raw as Record<string, unknown>
  req(Array.isArray(r.factions) && Array.isArray(r.nodes) && Array.isArray(r.edges) && Array.isArray(r.parties),
    'must have factions, nodes, edges, parties arrays')

  const factions: Faction[] = (r.factions as unknown[]).map((f) => {
    req(isObj(f) && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.color === 'string',
      'bad faction entry')
    const o = f as Record<string, unknown>
    return { id: o.id as string, name: o.name as string, color: o.color as string }
  })

  const nodes: WorldNode[] = []
  const ownership = new Map<NodeId, Owner>()
  const ids = new Set<string>()
  for (const n of r.nodes as unknown[]) {
    req(isObj(n), 'node is not an object')
    const o = n as Record<string, unknown>
    req(typeof o.id === 'string', `node missing string id`)
    const id = o.id as string
    req(!ids.has(id), `duplicate node id "${id}"`)
    ids.add(id)
    req(o.kind === 'settlement' || o.kind === 'waypoint', `node "${id}" bad kind`)
    req(typeof o.name === 'string', `node "${id}" missing name`)
    req(typeof o.x === 'number' && typeof o.y === 'number', `node "${id}" missing x/y`)
    const kind = o.kind as WorldNode['kind']
    req(kind !== 'settlement' || (typeof o.defense === 'number' && o.defense >= 0),
      `settlement "${id}" needs a numeric defense`)
    const defense = kind === 'settlement' ? (o.defense as number) : 0
    nodes.push({ id, name: o.name as string, kind, defense, x: o.x as number, y: o.y as number })
    if (kind === 'settlement') {
      req(typeof o.owner === 'string', `settlement "${id}" needs an owner`)
      ownership.set(id, o.owner as Owner)
    }
  }

  const edges: Edge[] = (r.edges as unknown[]).map((e) => {
    req(isObj(e), 'edge is not an object')
    const o = e as Record<string, unknown>
    req(typeof o.a === 'string' && ids.has(o.a) && typeof o.b === 'string' && ids.has(o.b),
      'edge references unknown node')
    req(typeof o.cost === 'number' && o.cost > 0, 'edge needs a positive cost')
    return { a: o.a as string, b: o.b as string, cost: o.cost as number }
  })

  const parties: Party[] = []
  const rosterSeeds: RosterSeed[] = []
  for (const p of r.parties as unknown[]) {
    req(isObj(p), 'party is not an object')
    const o = p as Record<string, unknown>
    req(typeof o.id === 'string' && typeof o.faction === 'string', 'bad party id/faction')
    req(typeof o.start === 'string' && ids.has(o.start), `party "${o.id}" bad start node`)
    req(typeof o.strength === 'number' && o.strength > 0, `party "${o.id}" needs positive strength`)
    const faction = o.faction as Owner
    parties.push({ id: o.id as string, faction, pos: o.start as string, strength: o.strength as number })

    const rawRoster = Array.isArray(o.roster) ? (o.roster as unknown[]) : []
    const units = rawRoster.map((u) => {
      req(isObj(u) && typeof u.id === 'string', `party "${o.id}" roster unit missing string id`)
      const uo = u as Record<string, unknown>
      req(
        uo.tier === 'levy' || uo.tier === 'supporting' || uo.tier === 'named',
        `party "${o.id}" roster unit "${uo.id}" bad tier`,
      )
      return { id: uo.id as string, tier: uo.tier as EconomyTier }
    })
    rosterSeeds.push({ faction, units })
  }

  return { world: { nodes, edges, factions }, ownership, parties, rosterSeeds }
}

// --- graph queries ---------------------------------------------------------

/** Adjacency: node id -> [{to, cost}]. Built once per World for pathfinding. */
export type Adjacency = Map<NodeId, Array<{ to: NodeId; cost: number }>>

export function buildAdjacency(world: World): Adjacency {
  const adj: Adjacency = new Map()
  for (const n of world.nodes) adj.set(n.id, [])
  for (const e of world.edges) {
    adj.get(e.a)!.push({ to: e.b, cost: e.cost })
    adj.get(e.b)!.push({ to: e.a, cost: e.cost })
  }
  return adj
}

export interface Paths {
  dist: Map<NodeId, number>
  prev: Map<NodeId, NodeId>
}

/**
 * Dijkstra from `from` over the adjacency. Linear-scan frontier (graphs are
 * tiny); ties in distance are broken by node id so the result never depends on
 * insertion or hash order.
 */
export function shortestPaths(adj: Adjacency, from: NodeId): Paths {
  const dist = new Map<NodeId, number>([[from, 0]])
  const prev = new Map<NodeId, NodeId>()
  const visited = new Set<NodeId>()

  for (;;) {
    let cur: NodeId | undefined
    let curDist = Infinity
    for (const [id, d] of dist) {
      if (visited.has(id)) continue
      if (d < curDist || (d === curDist && cur !== undefined && id < cur)) {
        curDist = d
        cur = id
      }
    }
    if (cur === undefined) break
    visited.add(cur)
    for (const { to, cost } of adj.get(cur) ?? []) {
      const nd = curDist + cost
      const existing = dist.get(to)
      if (existing === undefined || nd < existing) {
        dist.set(to, nd)
        prev.set(to, cur)
      }
    }
  }
  return { dist, prev }
}

/** The next node to step to when traveling from `from` toward `dest`, or null if
 *  already there or unreachable. */
export function nextHop(adj: Adjacency, from: NodeId, dest: NodeId): NodeId | null {
  if (from === dest) return null
  const { prev } = shortestPaths(adj, from)
  if (!prev.has(dest)) return null // unreachable
  let step = dest
  while (prev.get(step) !== from) {
    const p = prev.get(step)
    if (p === undefined) return null
    step = p
  }
  return step
}

/** The bundled default world, validated at import. */
export const defaultWorld: LoadedWorld = loadWorld(worldData)
