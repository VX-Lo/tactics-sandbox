# CLAUDE.md — agent contract for tactics-sandbox

This is the brief a fresh session reads **before touching anything**. It is the
authoritative source for architecture and constraints; `README.md` is
human-facing (what it is, how to run it), this is agent-facing (the rules and
why). When the two disagree, the **code wins** — fix the doc.

**This is a living document.** Whenever the human says "update CLAUDE.md," revise
it to match what changed: new sanctioned vocabulary, new systems, shifted
next-steps, new known issues. Keep it tight and durable — rules and their
rationale, never a changelog. Prune anything that has gone stale.

---

## Current state / Next up

- **Shipped:** deterministic tactics engine; data-driven units + event→effect
  abilities; FE-style combat with height-advantage crits; a run layer (roster,
  XP/level, live mid-battle evolution, permadeath, encounter choice); and
  **deployment choice** (roster > field cap; pick who fights each battle).
- **Likely next system:** the **promotion / third `supporting` tier** (unnamed
  units that distinguish themselves earn a name and graduate). See Deferred —
  don't start it until asked.

## North star (design intent)

A single-player **sandbox**: "Warband/X4-style emergent conquest, expressed
through turn-based tactics instead of real-time combat" — **not** a scripted Fire
Emblem campaign. Build small (roguelike-run length) now, then scale toward a
persistent world. Every system should be judged by whether it serves emergent,
replayable play, not authored set-pieces.

Attachment is meant to be **tiered, X4-style**: protagonists you mourn,
supporting units that hurt to lose, levy you spend. That is what the tier system
(below) exists to serve.

---

## Core architecture — non-negotiables

### 1. Units are data, not code
A unit is stats + movement + a list of `{trigger, condition?, effect}` abilities.
The ability dispatcher (`src/engine/abilities.ts`) matches an event's trigger and
runs **effect-primitives looked up in a `type → handler` registry**. It **never
switches over specific ability names**. Authoring an ability = composing existing
primitives in JSON (`data/abilities.json`), no engine change.

### 2. The fixed vocabulary is triggers + effect-primitives
These are the engine's bounded, deliberate vocabulary. As they exist in code now:

- **Triggers:** `on_gain`, `on_kill`, `on_move`, `on_turn_start`, `on_attack`,
  `on_take_damage`, `on_adjacent`, `on_level_up`.
- **Effect primitives:** `modify_stat`, `heal`, `heal_allies`, `append_epithet`,
  `grant_random_ability`.
- **Conditions:** `on_terrain`.

Adding a new trigger/primitive/field is a rare **"additive vocabulary"** change:
a new registry entry or enum value, composable and backward-compatible. Sanctioned
examples so far: `on_level_up`, the `tier` field, `heal_allies`, and the
run-agnostic `playerUnits` injection option on `Battle`.

**Changing engine _rules logic_ (movement, combat resolution, ability dispatch,
turn flow) is a different, heavier act. Flag it to the human before doing it —
never silently.** If a task turns out to need a rules change, stop and say so.

### 3. Clean seams / module boundaries (as they actually are)
```
src/engine/   the fixed engine — ZERO DOM imports, ignorant of the run layer
  rng          single seeded PRNG (mulberry32); the determinism spine
  types        shared data vocabulary (triggers, effects, Unit, Tier, ...)
  events       synchronous event bus
  grid, mapgen terrain: geometry + deterministic noise/feature generation
  content      JSON load/validate + unit instantiation
  movement     reachability / pathing / occupancy (pure)
  combat       FE-style round resolution + non-random forecast
  abilities    the event→effect executor (the primitive registry)
  battle       the integrator: turns, commands, win/loss, wiring
  ai           a small deterministic greedy policy — a *player* of the engine,
               not part of its rules (drives enemies; auto-plays battles in tests)

src/run/      the run layer — sits ABOVE the engine, drives it via public API only
  content      run's content variant (elves evolve on level-up, not on kill)
  biomes       named MapGenConfig presets
  encounters   deterministic candidate generation + XP scaling
  progression  XP thresholds + level math (pure)
  run          run state machine: roster, encounters, deployment, permadeath

src/ui/       presentation only, downstream of engine + run; computes no rules
  render, battle-view, run-render, main (battle.html), run-main (index.html)
```
The battle engine never learns what a run, XP, or an encounter is. The run
orchestrates battles through `Battle`'s public command API + event bus, owns
XP/level/deployment, injects chosen units via `playerUnits`, and fires
`on_level_up` through **its own** ability-system instance against the shared unit
object. Do not make the engine reach up into the run, or the run reach into
engine internals.

### 4. Determinism is non-negotiable
- All randomness routes through the single seeded PRNG (`src/engine/rng.ts`).
  **`Math.random` is banned in engine code.** (The only allowed use is the UI
  picking *which* seed to play — i.e. choosing which deterministic run to run —
  in `src/ui/*main.ts`.)
- A run must **replay byte-identically** given the same **seed + encounter
  choices + deployment picks**. The run derives two independent streams
  (`encounterRng`, `progressionRng`) from the seed; deployment picks are recorded
  (`deploymentHistory`) and injected in canonical roster order (not click order).
- **Why it matters:** it makes the engine testable now (`test/run.test.ts`,
  `test/battle.test.ts` assert identical replays) and **mass-simulable later** —
  overnight AI-vs-AI balance runs are a planned use. Never introduce nondeterminism
  (wall-clock, unseeded RNG, iteration-order dependence on hashing, async races).

---

## The tier system

`Tier = 'named' | 'unnamed'` today (on unit data; the engine never branches on it
— only the run layer and presentation do). Planned: a third **`supporting`** tier
plus a **promotion** mechanic (unnamed units that distinguish themselves earn a
name and graduate). The union is intentionally left open for this. Tier is the
mechanism behind tiered attachment (mourn / hurts-to-lose / spendable).

## Deferred features — do NOT build early by accident

Only build these when explicitly asked:
- Promotion / the third `supporting` tier
- LLM name generation
- Wound / recovery economy (**heal-to-full between battles is a placeholder** for
  this — see Known issues)
- Recruitment / gaining new units
- Shops / economy
- Persistent world map

---

## Working conventions

**Model per task** (match effort to blast radius):
- **Opus / High** — anything touching engine *shape* or adding a system.
- **Opus / Max** — reserved for changes that must stay coherent across the whole
  engine at once.
- **Sonnet / High** — content, data, and isolated diffs.
- If a task you're on turns out to need engine-wide coherence, **ask the human
  before proceeding** rather than pushing on at the wrong tier.

**Git:** commit per logical unit of work with specific messages (what changed and
why); **push working states only**, never broken intermediates.

**Verify before committing:** `npm run typecheck && npm test` must be green.
Requires **Node 18+**; if `node` resolves to an older version (nvm can shadow the
system binary), use the system Node 18 explicitly.

---

## Known issues — carry forward, do NOT "fix" unprompted

- **Stalemate edge.** Forces isolated by impassable terrain (e.g. water) can bog
  down with no closer. The driver (`ai.autoPlay`) stops on a no-progress round and
  `run.finishBattle` treats an unresolved battle as a draw (no reward, deaths still
  counted, run advances). The **interactive UI has no stalemate escape** (Continue
  only appears on a decided outcome). This is deliberately unhandled — noted here
  so it isn't "discovered" and refactored without context. Raise it before changing.
- **Heal-to-full between battles is a deliberate placeholder** pending the recovery
  economy. Benching is currently pure opportunity cost (XP only), kept cleanly
  separable so persistent wounds can slot in later. Don't "fix" it into a real heal.
