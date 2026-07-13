// The campaign state machine: a minimal, deterministic, persistent loop on a
// node-graph world. Core verb: take and hold territory in a world that changes
// without you (the rival captures while you are elsewhere).
//
// Determinism spine: the ONLY randomness is a per-battle seed drawn from the
// campaign PRNG at each capture, plus the economy's small seeded income jitter
// (see economy.ts); movement and target-picking are pure. A campaign therefore
// replays byte-identically from (seed + the ordered choiceLog).
//
// Loop step (`turn`): player order -> economy tick (income, upkeep, debt, MIA
// returns, for every faction) -> rival step (reacts to the fresh totals) ->
// time advance (time is folded into the player's travel edge). Ownership is
// the source of truth for territory.

import { makeCampaignRng, type CampaignRng } from './rng'
import { autoResolve } from './resolve'
import {
  ECONOMY,
  makeStubRosterPort,
  rivalExpandDecision,
  tickEconomy,
  type EconomyConfig,
  type Resources,
  type RosterPort,
  type RosterUnitStub,
} from './economy'
import { buildAdjacency, nextHop, shortestPaths, type Adjacency, type LoadedWorld } from './world'
import { PLAYER, type CampaignEvent, type NodeId, type Order, type Owner, type Party, type ResolveBattle, type World, type WorldNode } from './types'

export interface CampaignOptions {
  /** The combat socket. Defaults to the deterministic auto-resolver stub. */
  resolveBattle?: ResolveBattle
  /** The roster the economy reads/mutates for upkeep. Defaults to an
   *  in-memory stub seeded from the world data (see economy.ts's STUBBED
   *  SEAM) — inject a real implementation once the run layer is wired in. */
  rosterPort?: RosterPort
  /** Economy tuning. Defaults to data/economy.json; tests override this to
   *  pin down jitter/thresholds exactly. */
  economy?: EconomyConfig
}

export class Campaign {
  readonly world: World
  readonly seed: number
  clock = 0
  turnCount = 0
  readonly choiceLog: Order[] = []
  readonly events: CampaignEvent[] = []

  // Mutable campaign state (cloned from the loaded world so instances never share).
  private ownership: Map<NodeId, Owner>
  private parties: Party[]
  private readonly resources: Map<Owner, Resources>
  // Consecutive ticks each faction's Scrip has held at/above the rival policy's
  // expand threshold — the "reaction lag" counter (see economy.rivalExpandDecision).
  private readonly expandStreak = new Map<Owner, number>()

  private readonly rng: CampaignRng
  private readonly resolveBattle: ResolveBattle
  private readonly rosterPort: RosterPort
  private readonly econ: EconomyConfig
  private readonly adj: Adjacency
  private readonly nodeById: Map<NodeId, WorldNode>

  constructor(loaded: LoadedWorld, seed: number, opts: CampaignOptions = {}) {
    this.world = loaded.world
    this.seed = seed
    this.rng = makeCampaignRng(seed)
    this.resolveBattle = opts.resolveBattle ?? autoResolve
    this.rosterPort = opts.rosterPort ?? makeStubRosterPort(loaded.rosterSeeds)
    this.econ = opts.economy ?? ECONOMY
    this.ownership = new Map(loaded.ownership) // clone: source of truth for territory
    this.parties = loaded.parties.map((p) => ({ ...p })) // clone
    this.resources = new Map(
      loaded.parties.map((p) => [p.faction, { scrip: this.econ.startingScrip, stores: this.econ.startingStores }]),
    )
    this.adj = buildAdjacency(this.world)
    this.nodeById = new Map(this.world.nodes.map((n) => [n.id, n]))
  }

  // --- the loop --------------------------------------------------------------

  /** Advance one campaign turn: the player's order, then the economy ticks
   *  for every faction (income, upkeep, debt, MIA returns — pays upkeep
   *  before anyone spends), then the rival reacts to the fresh totals. */
  turn(order: Order): void {
    this.turnCount += 1
    this.choiceLog.push(order)
    this.applyPlayerOrder(order)
    this.economyStep()
    this.rivalStep()
  }

  private economyStep(): void {
    for (const faction of this.rosterPort.factions()) {
      const bank = this.resourceBank(faction)
      const result = tickEconomy(this.rosterPort, faction, bank, this.ownedCount(faction), this.turnCount, this.econ, this.rng)
      for (const f of result.failures) {
        const name = this.factionName(faction)
        if (f.outcome === 'lost') this.event('note', `${name} cannot feed a levy — ${f.unitId} is lost.`)
        else if (f.outcome === 'mia') this.event('note', `${name} cannot feed ${f.unitId} — it goes missing.`)
        else this.event('note', `${name} cannot feed ${f.unitId} — the debt grows.`)
      }
      for (const id of result.miaReturned) this.event('note', `${this.factionName(faction)}'s ${id} returns from MIA.`)
    }
  }

  private resourceBank(faction: Owner): Resources {
    let bank = this.resources.get(faction)
    if (!bank) {
      bank = { scrip: 0, stores: 0 }
      this.resources.set(faction, bank)
    }
    return bank
  }

  private applyPlayerOrder(order: Order): void {
    const player = this.playerParty()
    if (!player) return // player was defeated; orders are no-ops
    switch (order.op) {
      case 'travel': {
        const hop = nextHop(this.adj, player.pos, order.dest)
        if (hop) {
          this.clock += this.edgeCost(player.pos, hop) // travel is the only time sink
          player.pos = hop
        }
        break
      }
      case 'capture':
        this.tryCapture(player)
        break
      case 'wait':
        break
    }
  }

  // The one autonomous agent (pillar: agents, thin). A DUMB deterministic agenda
  // (nearest unowned settlement) GATED by the spending policy: pay upkeep first
  // (already done in economyStep, which runs before this), and only pursue
  // expansion once Scrip has held above the threshold for the policy's
  // reaction-lag ticks — otherwise hold in place. No strength check either way —
  // once cleared to act it may still march on a fortress it cannot crack.
  private rivalStep(): void {
    const rival = this.rivalParty()
    if (!rival) return
    if (!this.rivalReadyToExpand(rival.faction)) return // holding: building surplus
    const target = this.nearestUnowned(rival)
    if (!target) return // owns everything reachable — idle
    if (rival.pos === target) {
      this.tryCapture(rival) // arrived last turn: assault this turn
    } else {
      const hop = nextHop(this.adj, rival.pos, target)
      if (hop) rival.pos = hop // rival moves one hop/turn (turn-paced; no clock cost)
    }
  }

  // Pure policy step (economy.rivalExpandDecision) wrapped with this campaign's
  // persistent per-faction streak state.
  private rivalReadyToExpand(faction: Owner): boolean {
    const { ready, streak } = rivalExpandDecision(this.resourceBank(faction).scrip, this.expandStreak.get(faction) ?? 0, this.econ)
    this.expandStreak.set(faction, streak)
    return ready
  }

  // Capture the settlement the party stands on, if it is not already theirs. A
  // flat Scrip cost gates the attempt up front — no seed is drawn and nothing
  // else happens if the faction can't afford it (a no-op order, same as an
  // unreachable travel). Otherwise this is the ONLY place a battle (and thus
  // PRNG) is consumed. Attacker wins -> ownership flips and persists, attacker
  // weakened; attacker loses -> attacker removed.
  private tryCapture(party: Party): void {
    const node = this.nodeById.get(party.pos)
    if (!node || node.kind !== 'settlement') return
    if (this.ownership.get(node.id) === party.faction) return // already ours

    const bank = this.resourceBank(party.faction)
    if (bank.scrip < this.econ.captureCost) {
      this.event('note', `${this.factionName(party.faction)} cannot afford to move on ${node.name}.`)
      return
    }
    bank.scrip -= this.econ.captureCost
    this.expandStreak.set(party.faction, 0) // acted on the surplus; the lag resets

    const seed = this.rng.nextSeed()
    const outcome = this.resolveBattle({ strength: party.strength }, { strength: node.defense }, seed)

    if (outcome.winner === 'attacker') {
      party.strength += outcome.attackerDelta // <= 0; auto-resolver keeps it >= 1
      this.ownership.set(node.id, party.faction) // the payoff: territory flips, persists
      this.event('capture', `${this.factionName(party.faction)} captured ${node.name} (strength now ${party.strength}).`)
    } else {
      this.removeParty(party.id) // the defeated party is removed from the map
      this.event('defeat', `${this.factionName(party.faction)}'s warband was destroyed assaulting ${node.name}.`)
    }
  }

  // --- queries (the map view + tests read these) -----------------------------

  playerParty(): Party | undefined {
    return this.parties.find((p) => p.faction === PLAYER)
  }

  /** The single roaming rival (any non-player party), or undefined once destroyed. */
  rivalParty(): Party | undefined {
    return this.parties.find((p) => p.faction !== PLAYER)
  }

  allParties(): readonly Party[] {
    return this.parties
  }

  ownerOf(settlementId: NodeId): Owner | undefined {
    return this.ownership.get(settlementId)
  }

  ownedCount(owner: Owner): number {
    let n = 0
    for (const v of this.ownership.values()) if (v === owner) n += 1
    return n
  }

  nodeOf(id: NodeId): WorldNode | undefined {
    return this.nodeById.get(id)
  }

  factionName(id: Owner): string {
    return this.world.factions.find((f) => f.id === id)?.name ?? id
  }

  factionColor(id: Owner): string {
    return this.world.factions.find((f) => f.id === id)?.color ?? '#888'
  }

  /** Can the player capture where it currently stands (and afford to try)? */
  canCaptureHere(): boolean {
    const p = this.playerParty()
    if (!p) return false
    const node = this.nodeById.get(p.pos)
    if (!node || node.kind !== 'settlement' || this.ownership.get(node.id) === PLAYER) return false
    return this.resourceBank(PLAYER).scrip >= this.econ.captureCost
  }

  /** Read-only copy of a faction's current Scrip/Stores. */
  resourcesOf(faction: Owner): Resources {
    return { ...this.resourceBank(faction) }
  }

  /** Read-only copy of a faction's roster stub (see economy.ts's STUBBED SEAM). */
  rosterOf(faction: Owner): RosterUnitStub[] {
    return this.rosterPort.units(faction).map((u) => ({ ...u }))
  }

  /** Node ids the player can travel to (reachable, excluding its current tile). */
  travelTargets(): NodeId[] {
    const p = this.playerParty()
    if (!p) return []
    const { dist } = shortestPaths(this.adj, p.pos)
    return this.world.nodes.filter((n) => n.id !== p.pos && dist.has(n.id)).map((n) => n.id)
  }

  // --- internals -------------------------------------------------------------

  private nearestUnowned(party: Party): NodeId | null {
    const { dist } = shortestPaths(this.adj, party.pos)
    let best: NodeId | null = null
    let bestD = Infinity
    for (const n of this.world.nodes) {
      if (n.kind !== 'settlement') continue
      if (this.ownership.get(n.id) === party.faction) continue
      const d = dist.get(n.id)
      if (d === undefined) continue
      if (d < bestD || (d === bestD && (best === null || n.id < best))) {
        bestD = d
        best = n.id
      }
    }
    return best
  }

  private edgeCost(from: NodeId, to: NodeId): number {
    return this.adj.get(from)?.find((e) => e.to === to)?.cost ?? 0
  }

  private removeParty(id: string): void {
    this.parties = this.parties.filter((p) => p.id !== id)
  }

  private event(kind: CampaignEvent['kind'], message: string): void {
    this.events.push({ turn: this.turnCount, kind, message })
  }

  /**
   * A plain, deterministic snapshot: the full replayable campaign state in a
   * stable field/element order (ownership in node order, parties sorted by id).
   * Two campaigns with the same seed + choiceLog produce equal snapshots.
   */
  snapshot() {
    return {
      seed: this.seed,
      clock: this.clock,
      turnCount: this.turnCount,
      ownership: this.world.nodes
        .filter((n) => n.kind === 'settlement')
        .map((n) => ({ id: n.id, owner: this.ownership.get(n.id)! })),
      parties: [...this.parties]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((p) => ({ id: p.id, faction: p.faction, pos: p.pos, strength: p.strength })),
      resources: [...this.resources.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([faction, r]) => ({ faction, ...r })),
      rosters: this.rosterPort
        .factions()
        .slice()
        .sort()
        .map((faction) => ({
          faction,
          units: [...this.rosterPort.units(faction)].sort((a, b) => (a.id < b.id ? -1 : 1)),
        })),
      events: this.events.map((e) => ({ ...e })),
      choiceLog: this.choiceLog.map((o) => ({ ...o })),
    }
  }
}
