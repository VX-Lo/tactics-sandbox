// The commitment policy — the SINGLE seam that decides whether a unit action is
// REVERSIBLE (can be rewound by intra-unit undo) or COMMITTING (locks the turn).
// Every action routes through this one function; the rule lives nowhere else, so
// swapping policies later (stricter rulesets, future battle models) is a
// one-function change, not a hunt through input handlers.
//
// Exactly one policy is implemented: **"commit on reveal"**. An action COMMITS
// iff it resolves randomness OR reveals hidden information — because undoing such
// an action would let the player re-roll a resolved outcome, a variance-rule
// violation (save-scum). When in doubt, commit: never let an action that rolled
// dice or exposed hidden state be undone.
//
// Today the only committing action is an ATTACK (it resolves combat RNG, and can
// reveal kills/evolutions). Movement is a pure spatial state change — no PRNG is
// touched, no ability consumes randomness on `on_move` in current content — so it
// is reversible. If a move ever gains an RNG/reveal side effect, it must be
// reclassified here, and ONLY here.

export type ActionKind = 'move' | 'attack'

export type Reversibility = 'reversible' | 'committing'

/** Classify an action under the "commit on reveal" policy. */
export function classifyAction(kind: ActionKind): Reversibility {
  switch (kind) {
    case 'attack':
      return 'committing' // resolves combat RNG / reveals kills
    case 'move':
      return 'reversible' // no randomness, no hidden-state reveal
  }
}
