# Elves of the Deepwood — a tactics-RPG engine prototype

A single-player tactics game in the Fire Emblem tradition, built as the seed of
a larger sandbox. Four elves defend a procedurally generated forest against an
undead horde across a short **run** of battles. Units are **data, not code**:
they carry their own stats, movement, and a list of triggered abilities, and
they **evolve mid-battle** as they earn XP — a level-up teaches a new ability
and earns a new name. Survivors carry forward between battles; the dead are gone
for good.

## Quickstart

Requires **Node 18+** (the toolchain is pinned in `package.json`).

```bash
npm install
npm run dev      # play in the browser (Vite, http://localhost:5173)
npm test         # run the headless test suite (Vitest)
npm run build    # typecheck + production build
```

- **`/`** — the full run: pick one of three encounters, choose which units to
  field (the roster outsizes the field cap), then fight it.
- **`/battle.html`** — a single-battle sandbox for a raw skirmish on a seed.

Play: click one of your elves to see her move range (blue), click a tile to
move, then click an in-range enemy (red) to attack — hover a target first for a
combat forecast. **End Turn** hands off to the undead. Kills earn XP; crossing a
level threshold evolves an elf mid-fight. Clear the encounter, choose the next,
and try to survive the run.

## Design philosophy

Four commitments shape everything here:

1. **Units are data, not code.** The engine never hardcodes "a knight moves
   like this." A unit is a bundle of stats + movement + a list of
   `{trigger, condition, effect}` abilities. The engine reads and executes those
   bundles. Adding an ability is a data edit; if it ever required an
   `if`-statement in the engine, the design would be wrong.
2. **Composable, single-responsibility modules.** Movement, combat, abilities,
   and terrain are each self-contained with clean seams. Any one can be rebuilt
   without the others caring. Battle orchestration is the only integrator.
3. **Simulation is separate from presentation.** The whole engine runs headless
   with no DOM. Battles are **deterministic given a seed and inputs** —
   identical every time. The UI is just one driver of the engine's command API;
   tests and mass simulation are others.
4. **Comment the *why*, not the *what*.** Comments are reserved for non-obvious
   design decisions and tradeoffs.

## Architecture

```
data/                 hand-editable JSON content (the modding layer)
  terrain.json        terrain kinds: move cost, defense, avoid, passability
  abilities.json      the event->effect ability library + evolution pool
  units.json          unit templates (stats, movement, attack, abilities)

src/engine/           the fixed, small engine — no DOM, fully testable
  rng.ts              seeded PRNG; the single source of all randomness
  types.ts            the shared data vocabulary
  events.ts           synchronous event bus
  grid.ts             pure grid geometry + terrain lookup
  mapgen.ts           deterministic noise + feature-pass map generation
  content.ts          JSON validation/loading + unit instantiation
  movement.ts         reachability, pathing, occupancy (pure)
  combat.ts           FE-style round resolution + non-random forecast
  abilities.ts        the event->effect executor (registry of primitives)
  battle.ts           orchestration: turns, commands, win/loss, wiring
  ai.ts               a small deterministic greedy policy (drives enemies)

src/run/               the run layer — sits ABOVE the engine, drives it
  content.ts          run's content variant (elves evolve on level-up)
  biomes.ts           named MapGenConfig presets (terrain per encounter)
  encounters.ts       deterministic candidate generation + XP scaling
  progression.ts      XP thresholds + level math (pure)
  run.ts              run state machine: roster, encounters, deployment, permadeath

src/ui/               presentation only, downstream of the engine
  render.ts           pure (battle, view) -> HTML (board + panels)
  battle-view.ts      mountable battle UI, shared by sandbox and run
  run-render.ts       pure (run) -> HTML (roster / deploy / end screens)
  main.ts             single-battle sandbox controller (battle.html)
  run-main.ts         run controller: sequences roster -> deploy -> battle (index)
  style.css
```

**Data format is JSON** (not TOML): the ability grammar is a nested
event→effect tree, and JSON nests arbitrary trees natively while staying
greppable and diff-friendly. `_note` fields carry human annotation.

**Determinism** is load-bearing. Every stochastic decision — hit, crit, ability
picks, map noise — draws from a PRNG seeded once per battle (`rng.ts`);
`Math.random` is banned in engine code. `test/battle.test.ts` proves that two
same-seed battles auto-play to a byte-identical state and log.

## The run layer

A **run** is a sequence of battles (4 by default) with persistent, evolving
units, built entirely *above* the battle engine: it drives `Battle` only through
the public command API and observes it only through the event bus. The engine
never learns what a run, XP, or an encounter is. The seams that make this work
without changing rules logic:

- **XP/level live in the run, not on the engine `Unit`.** A `RosterEntry
  {unit, xp, level}` holds progression; the engine `Unit` stays exactly what
  battle needs.
- **Evolution reuses the ability grammar.** The run supplies a content variant
  where elves carry `evolve_on_level` (trigger `on_level_up`) with the *same*
  grant+rename effects as the on-kill version. When a unit levels, the run fires
  `on_level_up` through its **own** ability-system instance against the shared
  unit — so evolution happens (mid-fight, live) with zero engine involvement.
- **Persistent units carry across battles** via a run-agnostic `playerUnits`
  option on `Battle` (deploy pre-built instances instead of instantiating a
  roster; their `on_gain` passives aren't re-applied).
- **XP has two sources** (per the design): live **kill-XP** during a fight
  (observed on `on_kill`, evolves mid-battle), scaled by victim strength ×
  difficulty; and **clear-XP** to each *deployed* survivor on victory. Thresholds
  are cumulative `100/250/450/700`, one evolution per level. Deployed units heal
  to full each battle (no healing economy yet); **permadeath is persistent** —
  the fallen leave the roster for the whole run.
- **Encounters are data.** Each interval the run generates three candidates
  (difficulty → enemy strength budget + XP reward, biome → mapgen preset, plus a
  battle seed). Picking one is the whole decision.
- **Deployment is a choice.** The roster (6 named elves) exceeds a per-battle
  field cap (4), both `RunConfig`-tunable. After choosing an encounter the
  player fields a subset: only deployed units are injected, healed, and earn XP.
  Benched units sit out — no kill-XP, no clear-XP, no damage, cannot die — and
  carry forward untouched. A battle can be lost with benched survivors and the
  run continues; it ends only when the whole roster is dead or all battles pass.
  The engine already accepted an arbitrary injected unit list, so this is purely
  the run choosing *which* units to inject.

**Determinism** extends to the whole run: it is fixed by its seed plus the
ordered list of **encounter and deployment picks**, with independent RNG streams
for encounter generation and evolution rolls. Deployment picks are recorded in
`deploymentHistory` (and `snapshot()`); injection uses canonical roster order,
independent of click order. `test/run.test.ts` proves two same-seed, same-choice
runs are byte-identical.

The only engine-file changes the run required were **additive vocabulary**: an
`on_level_up` trigger, a `tier: named | unnamed` field on units, the
`playerUnits` injection option, and a `heal_allies` effect primitive (for the
mender archetype's aura — a new registry entry, not a rules change). Movement,
combat, and ability *resolution* are untouched, and the engine's `defaultContent`
behaviour and tests are unchanged.

## The ability grammar (the core bet)

The engine emits **events** (`on_kill`, `on_move`, `on_turn_start`, `on_gain`,
…). An ability names a trigger, an optional condition, and a list of effects.
Effects and conditions are looked up by string `type` in **registries of
primitive handlers** (`modify_stat`, `heal`, `grant_random_ability`,
`append_epithet`; `on_terrain`). The dispatcher just matches triggers and runs
whatever the data says — it knows nothing about any specific ability.

The line the engine draws: **triggers and effect-primitives are its fixed,
bounded vocabulary; abilities are data compositions of them.** Extending the
vocabulary is a deliberate engine change; recombining it is not.

The whole evolution mechanic is *itself just data* — proof the system works:

```json
{
  "id": "evolve_on_kill",
  "trigger": "on_kill",
  "effects": [
    { "type": "grant_random_ability", "pool": ["swift_step", "keen_arm", "..."] },
    { "type": "append_epithet", "pool": ["the Bloodied", "Kin-Avenger", "..."] }
  ]
}
```

### Adding an ability — no engine change

Append to `data/abilities.json` and reference it from a unit or an evolution
pool. Example: "on a kill, gain +1 Speed" reuses existing primitives:

```json
{
  "id": "quickening", "name": "Quickening", "trigger": "on_kill",
  "effects": [{ "type": "modify_stat", "stat": "spd", "amount": 1 }]
}
```

A genuinely new *kind* of effect (say `teleport`) means registering one handler
in `abilities.ts` — the bounded, rare case, done once and then reusable forever.

## Rules summary

- **Terrain** (from noise): forest slows movement but grants defense and heavy
  avoid — the elves' home-ground edge; water and crags are impassable.
- **Combat** (FE-style rounds): attacker strikes, defender counters if the
  attacker is in its range, and a unit with a speed lead of ≥4 lands a
  follow-up. Damage is `atk − (def + terrain)`, floored at 1. Hit clusters high
  (`accuracy + skill − terrain avoid`, capped at 99).
- **Crit keys off height advantage.** Attacking from higher ground adds crit
  (+15% per elevation level); crit is a minor 1.5× multiplier. It reuses the
  map's elevation, is spatially legible, and needs no unit facing to track.
  Variance moves the *margin*, not the *outcome* — unless a unit was exposed.
- **Turns** are phase-based: all player units act, then all enemy units. Speed
  governs follow-ups, not turn order.
- **Permadeath**: the dead are gone.

## Deliberately not built

No recruitment (gaining new units), tier promotion or a third supporting tier,
generated names, wound/recovery economy, shops, rewards beyond XP, or a
persistent branching map. No cards, politics, or economy. The data model is
designed for that future (units drift
arbitrarily far from their templates, `tier` is left open for a third rank), but
the prototype exercises only a slice of it. Healing/recovery does not exist yet,
so units heal to full between battles — persistent wounds return once there's a
recovery economy to make benching a wounded unit a real cost.

## Note on Node

`node`/`npm` must be Node 18+. If a version manager pins an older default, use
your system Node or `nvm use 18`. The build was developed and verified on Node
18.19.
