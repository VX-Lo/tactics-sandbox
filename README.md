# Elves of the Deepwood — a tactics-RPG engine prototype

A single-player tactics game in the Fire Emblem tradition, built as the seed of
a larger sandbox. Four elves defend a procedurally generated forest against an
undead horde. Units are **data, not code**: they carry their own stats,
movement, and a list of triggered abilities, and they **evolve mid-battle** —
any kill teaches the killer a new ability and earns her a new name.

This is the first prototype: one good fight on one generated map.

## Quickstart

Requires **Node 18+** (the toolchain is pinned in `package.json`).

```bash
npm install
npm run dev      # play in the browser (Vite, http://localhost:5173)
npm test         # run the headless engine test suite (Vitest)
npm run build    # typecheck + production build
```

Play: click one of your elves to see her move range (blue), click a tile to
move, then click an in-range enemy (red) to attack — hover a target first for a
combat forecast. **End Turn** hands off to the undead. A kill makes an elf
evolve. Rout the horde to win; lose your last elf and the forest goes dark.

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

src/ui/               presentation only, downstream of the engine
  render.ts           pure (battle, view) -> HTML
  main.ts             controller: clicks -> engine commands
  style.css
```

**Data format is JSON** (not TOML): the ability grammar is a nested
event→effect tree, and JSON nests arbitrary trees natively while staying
greppable and diff-friendly. `_note` fields carry human annotation.

**Determinism** is load-bearing. Every stochastic decision — hit, crit, ability
picks, map noise — draws from a PRNG seeded once per battle (`rng.ts`);
`Math.random` is banned in engine code. `test/battle.test.ts` proves that two
same-seed battles auto-play to a byte-identical state and log.

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

No cards, politics, economy, campaign map, or between-battle progression. The
data model is designed for that future (units drift arbitrarily far from their
templates), but the prototype exercises only a slice of it. One fight, one map.

## Note on Node

`node`/`npm` must be Node 18+. If a version manager pins an older default, use
your system Node or `nvm use 18`. The build was developed and verified on Node
18.19.
