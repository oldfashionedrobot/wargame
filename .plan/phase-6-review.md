# Phase 6 — pre-planning review

A read of the phase 6 material (**Terrain**, **Units**, and the **§6 roadmap
entry**, which have to be read together) against the code as it stands at
`881018e`, after phase 5 landed.

**Scratch, not spec.** `architecture.md` is unchanged and still describes
phase 6 as originally written. Nothing here is decided — this exists to be
argued with, and gets absorbed into the plan or deleted when phase 6 is
re-planned. Same treatment the phase 5a decisions doc got.

**Verdict.** The architecture is sound and the big calls should survive. The
problems are at the edges — ordering, migration mechanics, UX gestures — not
in the core. It is *under-sequenced rather than overengineered*, with one
content overreach and one piece of scaffolding that should be labelled as
such. Two of the findings below would stop implementation on day one.

## Blockers — wrong, not merely vague

### 1. Phase 6 depends on work sequenced after it

The terrain table is keyed by `MovementType` (`foot | horse | wheels`), so
`exploreMovement(state, unit)` has to ask a unit which one it is. It cannot:

- `Unit` today is `{ id, position, facing, movementRange: number, owner, hasActed }` — no `unitTypeId`, no `movementType`
- `shared/src/data/unitTypes.ts` has the catalog (with `movementType` and
  per-type `movementRange`) and has sat **unreferenced** since early on
- wiring `Unit` to that catalog is **7a**, scheduled *after* phase 6

So phase 6 as written cannot be built. Fix: pull 7a in as phase 6's first
step. It is cheap — `Unit` lives inside `GameState`, which is a JSON blob, so
there is no schema migration (the same reasoning the plan already gives for
7b).

### 2. `validatePath` breaks the client the day it lands

`selection.ts:65` builds `path: [selectedUnit.position, coordinate]` — a
two-element straight line. The server accepts it today only because
`validateMove` reads `path[path.length - 1]` and ignores everything else.

`validatePath` requires each step to be orthogonally adjacent to the last, so
the moment it lands **every non-adjacent move is rejected**. The client's
switch to `pathTo` is not a follow-up commit; it is the same commit.

The plan frames `validatePath` purely as closing the unvalidated-`path` hole
and never says it also invalidates the only path shape the client can
currently produce.

### 3. Existing matches become unloadable, silently

`TileType` goes from `'land'` to the terrain union. Consequences:

- `current_state` is read on **every submit**, and `$type<GameState>()` is a
  compile-time assertion, not validation
- old rows keep `'land'` tiles, `TERRAIN['land']` is `undefined`, and the
  cost lookup throws
- the start screen still lists those matches, so opening one breaks the client

Dev-only data, so the answer is "wipe the dev database" — but it should be a
written step rather than a discovery. (`initial_state` has the same problem
and is never read, so it does not bite.)

### 4. `map_id` migration mechanics unstated

The plan calls this the first real schema migration and then leaves two
things unsaid: maps are **code modules** in `server/maps/`, so `map_id` is a
text column with no foreign key; and adding a `NOT NULL` column to a
non-empty table needs a default or nullability. Both are one-liners — which
is exactly the kind of thing the plan exists to have already decided.

## Overengineered

### Eight terrain types where six do the work

`sea` and `beach` are included explicitly "for map shape, not because naval
units exist." With an all-land roster, `sea` is impassable to all three
movement types — a wall with a different colour, plus a table row, plus a
renderer colour, plus a thing to tune around.

Ship **plains, road, bridge, forest, mountain, river**; add the coastline
when a map wants one. `bridge` does earn its place for the reason given: the
renderer must know it is a bridge to draw a road over water, and inferring
that from "road adjacent to river" is fragile.

### The confirmation step is friction until phase 7

After picking a destination the only available choice in phase 6 is
*confirm* — a second click that adds no information. Its actual purpose is
preparing the UI for 7's move-then-attack flow, which is legitimate, but it
should be named as scaffolding rather than presented as a phase 6 feature.

What *does* earn its place in 6 is the **route preview**: with variable
terrain cost the cheapest route is genuinely non-obvious, and seeing it
before committing is real information.

Under-specified regardless — none of this is written down:

- what confirms (a second click on the same tile?)
- what re-targets (clicking a different reachable tile?)
- what cancels (clicking the unit, or outside the range?)

### Not overengineering: `defense` unused until phase 7

Keep it. One table with both axes means adding a terrain type is one edit,
and `Record` exhaustiveness covers cost and defence at once. Splitting them
now and merging later is strictly worse.

## Sound — protect these

- **"The server validates the path, never re-derives it."** The best decision
  in the phase. Pathfinding needs no cross-machine determinism, so the
  client's search can change freely; manual routing later becomes a pure UI
  feature with no protocol change; and per-command server work drops from an
  O(board) Dijkstra to an O(path) walk. It *deletes* code —
  `canMoveUnit`'s `getReachableTiles` call leaves the server path entirely.
- **Character-grid maps.** The source file looks like the board, and it diffs
  and reviews like text.
- **Terrain before combat.** Four defence stars is a 40% reduction at full
  HP; tuning a matchup table with defence stubbed to zero produces numbers to
  throw away.

## Smaller inconsistencies

**"Road-bound" does not match the numbers.** The Units section says "cavalry
is fast but road-bound, artillery is slow *and* road-bound," but the sample
table gives horse cost 1 on plains — identical to infantry. As specced,
cavalry is *fast in the open and blocked by rough terrain*, which is a
different and better design. Only artillery meaningfully prefers roads
(wheels: plains 2, road 1). Align the prose with the numbers.

**The single-element path needs a carve-out.** A 1-element path is legal at
cost 0 ("attack without moving"). `validatePath`'s "final tile unoccupied"
check must exclude the moving unit itself, or a unit standing still fails its
own occupancy test — and `path[0]` is self-occupied on multi-step paths too.
In phase 6 this shape is just "wait in place", worth allowing since it costs
nothing and 7d needs it.

**`getReachableTiles` → `exploreMovement` is a barrel change.** It is
exported from `shared`'s barrel and consumed by `selection.ts`; the rename
ripples through `reachableTiles.test.ts` and the client tests. Mechanical,
but not free.

## A sequencing that would work

Five steps, each independently green-gateable:

| | | |
|---|---|---|
| **6a** | `Unit` gains `unitTypeId`, drops `movementRange` (7a pulled forward) | pure `shared/` + `initialState`, no migration |
| **6b** | terrain table; `exploreMovement` returning `reachable` + `pathTo` | pure, fully unit-testable; barrel rename |
| **6c** | `validatePath` in `validateMove` **and** the client sending `pathTo`'s result | one commit — they are a breaking pair |
| **6d** | maps in `server/maps/`, `createMatchState(map)`, `map_id` migration | wipe the dev database here |
| **6e** | terrain rendering, route preview, confirm gesture | 5c-3's Babylon import convention applies |

Verifiable with no combat, as the plan already says: does the overlay stop at
mountains, does cavalry outrange artillery in the open, does the server
reject a path through a river that wheels cannot ford.
