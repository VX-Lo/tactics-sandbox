# CLAUDE.md — cold-boot manifest

You are working on a video game. This file is written so a FRESH instance with zero
prior context can boot correct. Read it fully before doing anything. If a task
contradicts this file, stop and flag it.

============================================================
## 0. WHAT THIS IS (read this first, it changes every decision)
============================================================
- A single-player, 2D, turn-based tactics game that SCALES, in feel, like
  Mount & Blade: Warband and X4: Foundations: emergent sandbox conquest through
  tactics instead of real-time 3D combat. The tactics grid is the combat RESOLVER,
  not the game. The game is the world you conquer with it.
- NORTH STAR: the fantasy of being a nobody whose personal TACTICAL skill (not reflex,
  not RNG, not narrative privilege) legibly overcomes bad odds — "send fifty men just
  to kill me." Outcomes come from skill and system.
- NOT a scripted, chosen-one, Fire-Emblem-story game. Story is emergent.
- IT IS A GAME FOR ONE PERSON. Not a product, not a team codebase, not AAA.
- BUG BAR IS "FINAL FANTASY 1", NOT "ENTERPRISE". FF1 shipped famously buggy and is a
  classic. A bug the player will notice in play and fix in one sentence is CHEAP.
  Do NOT spend effort/tokens on enterprise-grade defensiveness, exhaustive edge-case
  armor, or belt-and-suspenders verification. Prefer shipping the feature and its
  flavor over proving it correct. Optimize for "works and feels right," not "provably
  safe." (EXCEPTIONS: the non-negotiables in section 1 — those DO earn rigor.)
- Runs on potato hardware. Offline-first. No heavy dependencies. Moddable data files.
  Target: the finished game is small (aim < 1 GB). The player's PC storage/CPU is free.

============================================================
## 1. NON-NEGOTIABLES (the load-bearing walls — these earn full rigor)
============================================================
These are the few things that are expensive to get wrong. Guard them.

1a. THE VARIANCE RULE.
    Luck may change HOW MUCH the player wins a fight by — never WHETHER they win it —
    unless the player exposed themselves to that risk. A resolved outcome the player
    walked into by their own choice (deploying/positioning a unit into danger) is fair
    game; a coin-flip that decides a fight the player didn't gamble on is a violation.

1b. DETERMINISM IS SACRED — and here is EXACTLY where and why.
    - All randomness flows through a seeded PRNG. Math.random is BANNED. No wall-clock.
    - A run/campaign replays BYTE-IDENTICALLY from seed + player choices.
    - The seed is RANDOM per run, but MUST be captured and recorded into run/campaign
      state at start (never generated-and-discarded). The player or a task may override
      it. A replay is worthless without its seed.
    - WHY: this enables the overnight AI-vs-AI balance sim (section 5) — replacing
      expensive human playtesting with a free machine process. This is the single
      biggest force-multiplier available; determinism is what buys it. Protect it.
    - Determinism must NEVER be something the player notices as stiffness. It's an
      engine property, not a gameplay feel.

1c. SCALING-BLEND.
    The game grows by altitude (party -> army -> empire) but systems BLEND across
    scale; they are never TAKEN AWAY as the player grows. Late-game, the player can
    still "pilot the small ship" — hand-fight a battle even while commanding armies.
    The auto-resolve vs. hand-fight CHOICE is the blend made mechanical (section 3).

============================================================
## 2. ARCHITECTURE & MODULE BOUNDARIES
============================================================
- Three layers, kept separate:
  1. TACTICS ENGINE — the deterministic battle grid (units, movement, attacks).
  2. RUN LAYER — XP, permadeath, deployment, promotion, recovery, names.
  3. CAMPAIGN LAYER — the strategic world map (nodes, ownership, agents, time).
- The campaign layer imports NOTHING from tactics internals. Their ONLY connection is
  the resolveBattle seam (section 3).
- Changing a module boundary or a cross-layer interface is an OPUS-level change.

============================================================
## 3. resolveBattle — THE SOCKET (most important seam in the project)
============================================================
- Signature: resolveBattle(attacker, defender, seed) -> outcome
  (outcome returns at minimum: winner, and strength/casualty deltas for each side).
- This is the ONLY interface between the campaign layer and combat.
- CURRENTLY a deterministic PLACEHOLDER auto-resolver. It MUST honor the variance rule:
  the STRONGER force always wins; the seed decides only the MARGIN (losses on each side),
  never the winner. Equal strength is the sole case the seed may decide.
- The real tactics engine will LATER implement this same interface under the same
  contract. Wiring it in is a separate, dedicated (Opus) session. Until then, treat the
  placeholder like the strategic layer's "heal-to-full" stand-in: fine to build on.

============================================================
## 4. CORE SYSTEM VOCABULARY
============================================================
- ATTACHMENT TIERS: levy (unnamed, spent) -> named (mourned). A middle "supporting"
  tier is structured-for but may not be built. Tier order lives in one table so tiers
  insert additively. The CAMPAIGN economy (below) has now built the supporting tier's
  MIA-state mechanic on its own stub roster — see section 7; the run/tactics-layer
  `Tier` union (engine/types.ts) is still just levy|named, untouched this pass.
- CAMPAIGN ECONOMY: two resources — Scrip (funds expansion, also the unit of named-tier
  debt) and Stores (funds upkeep). Flat per-settlement income (data/economy.json),
  summed identically regardless of node count. Every roster unit (deployed + benched)
  costs Stores/tick; a shortfall is paid highest-tier-first (named -> supporting ->
  levy) so it bites the levies first: levy lost permanently, supporting goes MIA
  (auto-returns after a fixed tick count — placeholder, not precious), named racks up
  interest-bearing Scrip debt and goes non-deployable until it auto-clears. Capturing a
  node costs a flat Scrip amount, gated up front (no seed drawn if unaffordable). The
  rival runs the identical accumulation function (no fudged numbers) and gates its own
  expansion on a small threshold + reaction-lag policy (economy.rivalExpandDecision) —
  pay upkeep first, hold until surplus clears the bar and the lag ticks by, then act.
- PROMOTION = IDENTITY GENESIS. Automatic on an earned trigger (never a manual button;
  the system anoints, the player does not). Current trigger: a levy that took real
  punishment and survived (an HP-watermark downward-crossing this battle). Promotion is
  IDENTITY-ONLY — a name + tier change, NO stat/ability divergence (that's deferred).
- NAMES: drawn from culture-keyed flat pools at names/{species}_{gender}.txt (one name
  per line). Each pool shuffled with an INDEPENDENT sub-seed (hash of run_seed + pool key)
  so adding pools later never perturbs existing pools' draw order. Pool files + contents
  + order are part of the replay contract. Register: humans = meaningful mixed-origin
  names (Katherine, Naomi...); elves/wilden = Japanese names. Only feminine elves exist
  now; structure supports more species/genders without a rewrite.
- ACTION ECONOMY: per-turn budgets — movementRemaining, attacksRemaining
  (attackBudget default 1). Free ordering: move/attack interleave in any order until
  budgets spent or the unit waits. Move-after-attack is allowed.
- UNDO (if present / when built): intra-unit only, via a single named "commit on reveal"
  policy. An action COMMITS (clears undo) iff it resolves RNG or reveals hidden info —
  attacks commit, moves are reversible. Undo is authoring-time only; undone actions are
  NEVER written to the replay record (which stores committed actions only). This exists
  partly to protect the variance rule (no re-rolling a resolved attack).
- WOUNDS/RECOVERY: "wounded" = current HP not yet recovered to max (no separate status
  or stat). Units recover a fixed fraction of max HP per encounter (deployed AND benched).
  maxHP is never reduced. Wounded units stay deployable — fielding one is a risk the
  player owns.
- SETTING (Actium): floating-island continent; three races (human, elf, wilden);
  ~9:1 female:male population; 1980s-level tech, pre-WWII weapons, heavy radio aesthetic;
  enemies include mechs and lycel (fungal mimics) plus humanoids. Norodael = a small,
  mostly-abandoned frontier region (the "nobody's" starting backwater).

============================================================
## 5. THE OVERNIGHT SIM (why determinism matters — planned, not shelved)
============================================================
A headless, no-render harness that runs thousands of seeded battles/campaigns to
completion and reports win-rates + outliers. It converts human playtesting into a free
overnight process and is the payoff of section 1b. Prerequisites: an AI that actually
uses the action economy, tactics wired into resolveBattle, seeds recorded to state.

============================================================
## 6. BUILD CONVENTIONS (how to work here efficiently)
============================================================
- TOKENS ARE THE BINDING CONSTRAINT. The player has a hard monthly/5-hour budget shared
  across all Claude usage. Every token spent here is one they can't spend elsewhere.
  Be concise. Don't re-derive this file. Don't over-explain.
- ASSUME COLD BOOT. Every prompt may come from a fresh instance. This file is your
  catch-up. Don't assume prior-conversation context.
- BATCH BY FEATURE-CLUSTER, not one-variable-at-a-time. Related systems that share
  context should be built together in one pass (shared setup, one test pass, no
  re-briefing). The old one-system-per-session rule is RETIRED for routine work; keep
  coherence via THIS file, not via tiny isolated steps.
- MODEL ROUTING (right-size to risk, not to ambition):
    Use the CHEAPER model by default. Reserve the expensive model for changes that are
    expensive to UNWIND, not merely expensive to make:
      * module boundaries / cross-layer interfaces (e.g. resolveBattle),
      * the determinism contract (seeds, replay, PRNG plumbing),
      * anything many files depend on.
    Test: "if this is subtly wrong, do I fix it in one sentence in play, or does it
    silently corrupt other systems?" One-sentence-fix -> cheap model. Silent corruption
    -> expensive model.
- WHEN IN DOUBT ABOUT A NON-NEGOTIABLE, STOP AND FLAG rather than proceeding. (This is
  the one place caution beats speed.) Everywhere else, prefer shipping.
- ALWAYS UPDATE THIS FILE at the end of a session: record what shipped, new seams,
  new deferrals. This file staying current is what makes cold boots cheap.

============================================================
## 7. CURRENT STATE  <<< KEEP IN SYNC — RECONCILE, DO NOT CLOBBER >>>
============================================================
NOTE: If the repo's existing state notes disagree with this section, the REPO is
authoritative for shipped-state. Update this section from reality; don't overwrite
accurate state with stale assumptions.

Believed shipped:
- Tactics engine; run layer (XP, permadeath).
- Deployment (roster > field cap; benched earn no XP).
- Promotion (levy -> named, HP-watermark trigger, identity-only) + name pools
  (names/elf_female.txt, culture-keyed, independent per-pool seeding).
- Wounds/recovery (gradual recovery replaced heal-to-full; promotion crossing fix).
- Budget action economy (movementRemaining/attacksRemaining, free ordering,
  move-after-attack, attackBudget default 1).
- Strategic skeleton (campaign module: node-graph world, settlement ownership,
  one roaming rival, resolveBattle placeholder honoring the variance rule).
- Unit inspection panel (read-only).
- Campaign economy (src/campaign/economy.ts): Scrip/Stores accumulation, flat
  per-node income with seeded jitter, roster upkeep with tiered failure, capture-cost
  gate, and the rival's threshold+reaction-lag spending policy. Supporting middle tier
  — narrowly: only its MIA-state upkeep-failure mechanic exists; no stat/ability
  divergence for the tier anywhere, and the run-layer `Tier` union is untouched (see
  section 4). Data: data/economy.json (upkeep costs, node base yield, rival policy
  thresholds, MIA return duration); data/world.json parties gained an optional
  `roster` field that seeds it.
- Campaign<->run roster contract (SHIPPED — was the Kaname pass). The RosterPort
  interface now lives in src/contracts/roster.ts, a layer-neutral module both sides
  import (dependency inversion), so the campaign reaches run-layer roster state
  without importing the run module. The "one system or two" call: TWO systems joined
  by unit id. The port carries ONLY run-owned truth — factions(), units()->{id,tier},
  removeUnit() (a levy's permadeath). MIA countdown and Scrip debt are campaign-only
  bookkeeping and DO NOT cross the port: they live in src/campaign/economy.ts's
  UpkeepLedger (makeUpkeepLedger), keyed by unit id. WHY: MIA/debt are meaningless
  without Scrip/Stores; keeping them off the port stops any implementer writing money
  concepts onto run-layer units and keeps the run layer runnable with no notion of
  Scrip. Two real port implementations: makeInMemoryRosterPort (world-data-seeded,
  the default, for factions with no live run — the rival, and the player pre-wiring)
  and makeRunRosterPort (src/run/roster-port.ts — the real adapter over a live Run's
  roster). Injected via CampaignOptions.rosterPort. Guarded by test/boundary.test.ts
  (fails the build if src/engine or src/run ever imports src/campaign).
- Campaign UI animation layer (src/ui/animate.ts, wired into campaign-view.ts /
  campaign-main.ts): tweens displayed numbers/gauge bars and flashes a settlement on
  capture, so state deltas read as motion instead of jump-cuts. Presentation only —
  it reads Campaign's existing public queries and never touches campaign/economy
  state, tick timing, or determinism; doesn't affect any tested contract.

AUDIT (this pass, diff 8624923..HEAD on ai/battle/content/movement/types/run.ts):
CLEAN, no fixes needed. Engine vocabulary was extended additively (Tier is now
table-driven via TIERS/DEFAULT_TIER/TIER_LABELS; action-economy budgets and
attackBudget replace hasMoved/hasActed; undo adds commitment.ts as a new primitive,
not a restructure). No engine/run file imports src/campaign. Determinism held: no new
Math.random/wall-clock; undo is authoring-time and never logged; the AI deliberately
ends its activation after one action to keep pre-economy trajectories byte-identical;
NameRegistry uses a separate derived sub-seed so it can't perturb the encounter/
progression streams.

In flight / uncertain — VERIFY against repo before building on:
- Intra-unit undo (commit-on-reveal) — SHIPPED (battle.ts activation/undo/canUndo,
  commitment.ts, test/undo.test.ts). No longer uncertain.
- Random-seed-recorded-to-state — confirm implemented.
- NOTE (pre-existing, out of scope this pass): test/combat.test.ts has 3 failing
  tests in resolveCombat sequencing (counters/doubles/miss damage). They predate and
  are unrelated to this pass (combat.ts was not in the audited batch). Not a
  determinism/boundary issue — a combat-resolution bug for a future combat pass.

============================================================
## 8. DEFERRED — see cool_ideas.txt
============================================================
Parked (not dead): ATB / active-turn combat (battle-MODEL change; biggest one),
emergent nemesis, cards-as-economy-lever, politics/intrigue third lever, rest-only
healing, terrain-differentiated movement cost, post-attack-move-penalty archetype
CONTENT, recruitment, shops, ability/stat divergence by tier (incl. the supporting
tier — its MIA mechanic shipped, section 7, but no stats/abilities), tolls/tariffs/
taxes on top of flat node income, node-level yield differentiation (settlement
development).
Do not build these without an explicit design decision to pull them into active work.
