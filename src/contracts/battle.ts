// The campaign<->combat contract: the SINGLE seam between the strategic layer
// and battle resolution. Like the RosterPort (roster.ts), this lives in the
// layer-neutral contracts module so BOTH sides can depend on it without an
// import arrow pointing the wrong way: the campaign CALLS this contract, a
// resolver IMPLEMENTS it, and they meet only here. (Previously these types
// lived inside src/campaign — fine while the only implementer was the in-campaign
// auto-resolver, but the moment a run-layer resolver implements the same socket,
// the contract has to sit where neither layer owns it. This file is that place.)
//
// THE TWO-PATH MODEL (CLAUDE.md 1c/3 — scaling-blend made mechanical):
// resolveBattle does NOT get richer and is NOT replaced. It becomes ONE of TWO
// resolvers that satisfy this SAME contract:
//   - AUTO-RESOLVE (src/campaign/resolve.ts): fast, headless, aggregate math.
//     The variance-rule stub — stronger force wins, seed decides only the margin.
//     Used for rival-vs-rival, player-delegated fights, and the overnight sim.
//   - HAND-FIGHT (src/run/battle-resolver.ts): the player pilots a real battle on
//     the tactics grid. Where tactical skill actually enters. The winner comes
//     from PLAY, which is variance-rule-legal precisely because hand-fighting is
//     the player choosing to expose themselves to that resolution.
// The campaign calls the socket and never learns which resolver answered.

/**
 * An opaque reference to one side of a battle. The campaign fills this from what
 * it ALREADY tracks — a faction id and an aggregate strength scalar — and knows
 * nothing more about the force. It does NOT embed unit internals: the run layer,
 * given `faction`, resolves the handle to real units on its own side of the seam
 * (the campaign reads named-unit facts back through the RosterPort, never from a
 * battle result — see roster.ts and CLAUDE.md).
 *
 * `faction` is the campaign's `Owner` (a plain string here to keep this module
 * layer-neutral, exactly as RosterPort types faction ids).
 */
export interface ForceHandle {
  faction: string
  /** The aggregate strength the campaign tracks for this force (party strength,
   *  or a settlement's static defense). The auto-resolver reads only this. */
  strength: number
}

/**
 * Everything a resolver needs, and NOTHING campaign-internal. The campaign knows
 * WHICH forces and WHERE; it does not know what a unit IS.
 */
export interface BattleRequest {
  attacker: ForceHandle
  defender: ForceHandle
  /** Selector for the contested node's terrain/biome. Stable per node (so a place
   *  always fights on its own ground). Aggregate auto-resolve ignores it; the
   *  hand-fight path uses it to pick the map. */
  terrainSeed: number
  /** The battle's PRNG seed — the ONLY randomness source (determinism contract,
   *  CLAUDE.md 1b). Drawn from the campaign PRNG per battle and recorded. */
  seed: number
}

/**
 * STRICTLY AGGREGATE (non-negotiable, and here is why): both resolvers must speak
 * this honestly, and auto-resolve is aggregate math that never simulates
 * individual units. If this carried named casualties, auto-resolve would have to
 * FABRICATE them. So it stays at the granularity the campaign already tracks —
 * per-force strength deltas. Deciding WHICH specific units fall/level/wound is
 * run-layer logic the run ALREADY owns (wounds, death, XP, promotion via
 * event-bus observation); the campaign reads the named consequences back through
 * the RosterPort by DIFFING, never from this result.
 */
export interface BattleResult {
  winner: 'attacker' | 'defender'
  /** Strength change for each side (<= 0). The caller applies these: the defeated
   *  force is removed; the weakened victor persists (kept >= 1). */
  attackerDelta: number
  defenderDelta: number
}

/**
 * The one interface between campaign and combat. Both the auto-resolver and the
 * real hand-fight resolver implement THIS signature and THIS contract; the
 * campaign never learns which implementation it holds.
 */
export type ResolveBattle = (request: BattleRequest) => BattleResult
