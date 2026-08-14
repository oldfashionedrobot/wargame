# Advance Wars Clone — Architecture

Turn-based strategy game, American Revolutionary War theme — infantry, cavalry, artillery rather than tanks and jets. React + TypeScript + Babylon.js, built with bun.

Hot-seat is the current mode — one client driving both players — but every session talks to a real server. Networked multiplayer is the end goal, and the server/client split exists from the start rather than being retrofitted.

**This document describes the target.** Everything is marked: ✅ built · 🚧 partial · ⬜ not built. It's the single running spec — no decision history, no changelog.

**Plays end-to-end right now**: select a unit, see its movement range, move it, end turn, repeat. Two players, two units each. Everything else below is target.

## Structure ✅

Bun workspaces, three packages, no task runner on top — builds are seconds long and there's no CI to cache for. Turborepo layers on later without moving files if that changes.

```
packages/
  shared/     zero dependencies — pure rulebook, no React, no Babylon, no I/O, no RNG
    src/index.ts    barrel — the package's public surface
    src/  types · coordinate · queries · legality · reachableTiles
          applyMove · applyEndTurn · applyAction
          protocol.ts  ⬜ Command / GameEvent / request + response shapes
      data/  unitTypes 🚧 · movementCost ⬜ · chargeThresholds ⬜ · damageTable ⬜
  server/     depends on shared only — owns the match
    src/index.ts    barrel
    src/  initialState ✅ · gameServer ⬜ · match ⬜ · log ⬜ · http ⬜ (Bun.serve)
  client/     depends on shared + (temporarily) server — Vite + React + Babylon
    index.html  vite.config.ts  public/
    src/  main.tsx · App.tsx · index.css
      game/  GameCanvas.tsx · interaction/ · render/ · net/ ⬜
```

Cross-package imports go through each package's barrel (`@aw/shared`, `@aw/server`), never into individual files.

The split is by **authority**, not subject matter:

- **`shared/`** — types, legality predicates, queries, pathfinding, the reducers, and the wire protocol. Pure functions either side may read. Reducers live here, not in `server/`: they take a state and return a new one, they never *hold* one.
- **`server/`** — the mutable state reference, roll generation, the event log, and match construction.
- **`client/`** — Babylon rendering, input, React, and the `GameServer` implementation that talks HTTP.

Separate `package.json` files are the point: `server/` doesn't list Babylon or React, so a stray import is a resolution error rather than something caught in review. `shared/` having zero dependencies is the same guarantee for purity.

**No runtime build step for `shared/`** — its `exports` point at TS source. Bun runs TS natively on the server; Vite compiles it for the client. (A real build would be needed only if the server ever moves off bun.) It *does* emit `.d.ts` for typechecking — see Verification.

**Dependency rule** — now enforced by package boundaries rather than convention:

- `shared/data/` imports nothing from the rest of `shared/`
- `shared/` imports from `shared/data/` only
- `server/` and `client/` both import from `shared/`; neither imports the other

Bun installs these *isolated* rather than hoisted — `packages/server/node_modules/` contains only `@aw/shared`, so a stray `import 'react'` there is a hard resolution failure rather than something caught in review.

*Temporary exception*: `client` depends on `@aw/server` for `createInitialState`, since it still constructs the state itself. Removed in phase 2, when the server owns it.

## Invariants

1. ⬜ **Exactly one mutable `GameState` reference exists, and `server/` owns it.** Everyone else holds immutable snapshots. *(Today `GameCanvas` owns it via `useState`.)*
2. ✅ **`shared/` is pure** — no I/O, no RNG, no Babylon, no React, no `Date.now()`.
3. ⬜ **`GameServer.submit()` is async**, from the first version — sync-to-async is a retrofit that touches every call site.
4. ✅ **`GameState` is JSON-serializable** — no `Map`, `Set`, class instances, `Date`, or functions reachable from it.
5. 🚧 **Reducers validate their own input.** Legality is checked inside the reducer, never assumed from the caller. Reducers return `{ ok: true; state } | { ok: false; reason }`. *(Ownership and reachability are checked; sender identity is not — see `actor` below.)*
6. ✅ **Single source of truth, derive the rest.** A unit's position lives only in `unit.position`. Tile occupancy, selection, transport cargo — all derived by querying `state.units`.
7. ✅ **Ephemeral UI state stays out of `GameState`** — hover, selection, camera, animation progress.
8. ⬜ **The client never resolves game outcomes** — no rolls, no damage math, no combat resolution. It submits commands and renders the events it gets back.

   It *may* read any deterministic part of `shared/` to **preview** — what's selectable (`legality.ts`), where a unit can move (`reachableTiles.ts`, already driving the blue overlay), what it could attack from there. That's consulting the rulebook for UI affordance, not deciding anything, and the server re-checks all of it as the actual enforcement.

   The line is **deterministic preview, yes; random resolution, no.**

## Server model ⬜

Pure server authority, no client-side prediction. An ordinary SaaS request/response app that happens to draw a battlefield: the client submits a command, waits, and renders what comes back.

**No hidden information.** Modelled on tabletop wargames — every player sees the whole board. No fog of war, ever; it isn't a deferral, it's out of scope.

### Three types, three jobs

| | Direction | Contents |
|---|---|---|
| **`Command`** | client → server | Intent only. No actor, no dice. Can be rejected. |
| **`Action`** | inside the server | `Command` + the `actor` the server attached + any rolls it generated. What reducers consume. |
| **`GameEvent`** | server → clients | A fact that already happened. What gets broadcast and animated. |

The server authenticates a command into an action, validates it, resolves it, and emits events. Keeping `Command` and `Action` distinct is what stops a client from supplying its own `actor` or its own dice — those fields exist only on the type the client can't send.

Events, not actions, are what gets broadcast: a client that renders facts needs no rule parity with the server, so a stale browser tab can't compute a divergent outcome, and animation gets its ordered sequence — move, hit, death — without re-running resolution in the renderer.

### Command shape

One command per unit action, matching AW's move-then-choose flow. Move and attack are a **single atomic command**, not two:

```ts
{ type: 'unitAction', unitId, path,
  then: { kind: 'attack', targetId } | { kind: 'wait' } }
```

Atomicity is the point: with separate commands, a move could succeed and its follow-up attack be rejected, leaving the unit stranded in the open having spent its turn. One command, one validation, one outcome.

**The client sends the path; the server validates it rather than deriving it.**

`validatePath(state, unit, path)` walks the array — O(path length), no search. It checks: starts at the unit's current tile, every step orthogonally adjacent to the last, no tile visited twice, no step onto impassable terrain or an enemy-occupied tile, total cost within the unit's movement budget, and the final tile unoccupied (friendly tiles are pass-through, not stopping points).

Cost accumulates over `path[1..n]` — you don't pay for the tile you're already on. So a **single-element path is legal and costs 0**: that's "attack without moving," and it's the only legal shape for a `canMoveAndAttack: false` unit.

Ownership, `hasActed`, and `actor` are checked separately. `validatePath` answers one question — is this route walkable by this unit right now — and stays composable with the rest.

This is the same stance as every other reducer — *check what you're told, don't assume how it was produced* — and it has two payoffs:

- **Manual routing is then a pure UI feature.** Deliberately walking the long way round a forest needs no protocol change, no new validation, nothing server-side. Just a different way of building the array the client already sends.
- **Pathfinding needs no cross-machine determinism.** Because the server never re-derives a route, `findPath` in `shared/` is a client-side convenience for previewing. It can use any heuristic or tie-break, and change freely, without risking disagreement.

What *does* have to agree is the **cost model** — the `movementCost` table and how cost accumulates. If the client's reachable-tile overlay and the server's budget check disagree, the UI offers a move the server then rejects. That's a UX bug rather than a correctness one, and it's a much weaker constraint than identical search behaviour.

`canMoveAndAttack: false` units are rejected if `path` has more than one element.

### Transport ⬜

HTTP + SSE, not WebSockets. Commands are inherently request/response, so the POST response *is* the answer — including the rejection reason. Only "another player did something" needs push.

```
POST /commands   → { ok: true, seq, events, state } | { ok: false, reason }
GET  /events     → SSE stream, each event id = seq
GET  /state      → current state (initial load, and curl-able)
```

- `EventSource` reconnects automatically and sends `Last-Event-ID`, so **reconnection catch-up is free**: the server replays log entries after that `seq`.
- Both events *and* resulting state go over the wire. Events drive animation; state is the truth to snap to afterward. Under a kilobyte, and it makes the client self-correcting — a missed event is fixed by the next message rather than desyncing silently.
- Bun serves both with no dependencies. HTTP/2 comes free from any reverse proxy at deploy time; the app server doesn't need it.

### Client-side interface

`GameCanvas` talks only to this, and never learns what's behind it:

```ts
interface GameServer {
  getState(): GameState
  submit(command: Command): Promise<CommandResult>
  subscribe(onUpdate: (events: GameEvent[], state: GameState) => void): () => void
}
```

### Identity ⬜

Server issues an opaque id on first contact; the client stores it in `localStorage` and sends it as a header on POST and a query param on the SSE connect.

**This is identity, not authentication** — anyone can send any id. Acceptable while hot-seat is a dev convenience; replaced wholesale by real accounts and auth, not incrementally hardened.

`actor` is attached by the server from that identity, **never read from the client payload**. Under hot-seat one connection drives both players, so the server stamps `actor = state.currentTurn` on whatever arrives. That is a deliberate concession, not a security model.

Reducers must then check `actor === state.currentTurn`. Today they check only that the *unit* belongs to whoever's turn it is, which over a network would let any connected player command another player's units — and `applyEndTurn` validates nothing at all, so anyone could end anyone's turn.

## Event log ⬜

The match is an initial state plus an ordered log of validated changes. Current state is derivable from it, though the server also keeps it materialized.

```ts
interface LogEntry {
  seq: number           // monotonic per match; the cursor for reconnect
  action: Action        // the command as authenticated: + actor, + rolls
  events: GameEvent[]   // what happened — the replayable record
}
```

The action is kept for audit — who tried what, and what the dice said. Events are what replays and what broadcasts.

**Materialize, don't fold.** The server holds current state in memory *and* appends to the log. Folding the whole log on every command is O(n) per action to save a kilobyte. The log is for replay, audit, and reconnect catch-up.

In-memory to start. Durable storage is a separate concern and can wait.

Events are per-change, at the granularity a client needs to animate:

```ts
type GameEvent =
  | { type: 'unitMoved'; unitId; path }
  | { type: 'unitAttacked'; attackerId; targetId; damage }
  | { type: 'unitDied'; unitId }
  | { type: 'turnEnded'; nextPlayer }
```

`applyAction` grows an events channel, additively:

```ts
applyAction(state, action) → { ok: true, state, events } | { ok: false, reason }
```

## State model

```ts
Coordinate  { col, row }                                        ✅
TileType    'land'                                              🚧 placeholder, see Terrain
Facing      'north' | 'east' | 'south' | 'west'                 ✅
PlayerId    string                                              ✅ never a union of colors
Player      { id, name, color }                                 ✅ color is display-only, never keyed on
GameState   { grid, units, players, currentTurn }               ✅

Unit {
  id, position, facing, owner, hasActed                         ✅
  movementRange                                                 🚧 moves onto UnitType
  unitTypeId, health, maxHealth                                 ⬜
}

Command       MoveCommand | EndTurnCommand                      ✅ (currently named *Action)
              UnitActionCommand (move + optional attack)        ⬜ replaces MoveCommand
Action        Command + actor: PlayerId + rolls                 ⬜
ActionResult  { ok: true, state } | { ok: false, reason }        ✅
              + events: GameEvent[]                             ⬜
GameEvent     see Event log                                     ⬜
```

- `PlayerId` is a plain string so player count isn't baked into the type system. Turn order is array rotation over `GameState.players`, wrapping via modulo — works for 2 or 4 players, and is where a "skip eliminated players" rule goes.
- **One `hasActed` flag**, not separate move/attack flags — one command per unit action sets it exactly once. Reset in `applyEndTurn` for the incoming player only.
- ⚠️ **`MoveAction.path` is currently an unvalidated field** — the reducer reads only the last element and never checks the intermediate steps. Fixed by `validatePath`.

## Content — `shared/data/`

Static content, not runtime state: what damage cavalry deals to infantry never changes mid-match. Plain TypeScript `Record<K, V>` tables, which give compile-time exhaustiveness — add a unit type and every incomplete table becomes a build error.

| File | Contents | |
|---|---|---|
| `unitTypes.ts` | `UnitType` catalog keyed by `UnitTypeId`, referenced by `Unit.unitTypeId` | 🚧 |
| `movementCost.ts` | `Record<MovementType, Record<TileType, number \| null>>`, `null` = impassable | ⬜ |
| `chargeThresholds.ts` | `Record<AttackerUnitTypeId, Record<DefenderUnitTypeId, number>>` | ⬜ |
| `damageTable.ts` | attacker-vs-defender base damage % | ⬜ |

`TileType` moves here from `shared/types.ts` when terrain lands — it's content vocabulary, and `movementCost.ts` needs it.

## Units

Three unit types, three movement types, one-to-one for now. Artillery is wheeled/horse-drawn — historically right for the era and a clean spread: infantry goes anywhere slowly, cavalry is fast but road-bound, artillery is slow *and* road-bound.

| Unit | Movement type | Ranged ⬜ | Charge ⬜ |
|---|---|---|---|
| Infantry | `foot` ✅ | musket fire | bayonet |
| Cavalry | `horse` ✅ | — | yes |
| Artillery | `wheels` ✅ | cannon | — |

Movement range, `ranged`, and `charge` are all fields on the same `UnitType` record — movement and combat aren't separate systems. The catalog currently carries identity and movement only.

## Terrain ⬜

`plain | road | forest | mountain | river | sea | beach`.

Movement cost is a function of *(movement type, terrain type)*, not either alone. This makes pathfinding a Dijkstra/uniform-cost search rather than plain BFS, since edge cost varies by who's moving. `getReachableTiles` is currently a terrain-blind BFS placeholder — correct only because every edge costs 1.

**One search, two outputs.** The same Dijkstra should yield both the reachable set (for the overlay) and per-tile predecessors, so `findPath(state, unit, destination)` reconstructs a route without a second traversal.

`findPath` is a **client-side convenience** — it suggests a route to preview and submit. The server never calls it; it runs `validatePath` on whatever arrives. So pathfinding needs no cross-machine determinism and can change heuristics freely. Only the *cost model* has to agree between the two, so that the reachable overlay doesn't offer moves the server rejects.

`sea` and `beach` are in the list for map shape, not because naval units exist — the v1 roster is entirely land. They're impassable to everything until there's something that floats.

Bridges are `road` mechanically — same cost, same 0 defense. Purely a renderer concern, not game state.

## Combat ⬜

**Damage**: base % from the attacker-vs-defender matchup table, scaled by attacker HP%, reduced by defender terrain defense (itself scaled by defender HP%, so a hurt defender loses most of its terrain bonus), plus a small luck swing. Result is a % of defender max HP removed.

**Damage preview** is the sharp edge of invariant 8, and AW shows one before you commit. The client computes it from the same formula with the luck term omitted — a deterministic estimate, explicitly not a prediction of the result. The server rolls and decides the real number, which will differ. Preview the formula, never the dice.

**Ranged** — one category, not two:

```ts
ranged: { range: { min, max }, canMoveAndAttack: boolean }
```

`min === 1` behaves like AW direct fire (adjacent through max, symmetric counter-attack). `min > 1` behaves like indirect fire (can't hit adjacent, no counter given or received). The category falls out of the numbers; no separate flag.

`canMoveAndAttack` is independent of range category — a mounted archer can be indirect *and* mobile; a cannon indirect and static.

No line-of-sight system. Ranged combat matches AW's actual model, which never had LoS.

**Charge** — a distinct attack type, chosen instead of firing on a given turn, consuming `hasActed` either way. Capability lives on the attacker's `UnitType` (`charge?`), optional; any unit can be a *target* regardless.

Requires the attacker to be able to enter the target's tile — reuses `movementCost.ts`, so if the target's terrain is `null` for the attacker's movement type, charge isn't available.

```
margin   = targetCurrentHP% − matchupThreshold%
luckRoll = random(0, luckMax)
success  = margin <= luckRoll
```

No clamp needed — it falls out of `luckMax` being bounded. `margin ≤ 0` always succeeds; a small positive margin needs a good roll; a margin above `luckMax` is impossible.

- **Success**: target dies, attacker displaces onto the vacated tile.
- **Failure**: attacker takes bonus damage scaled by `margin`, no position change.

**Untuned**: `luckMax`, every threshold value, the failure-damage scaling function, and the whole damage matchup table.

## Rendering ✅

- `client/render/` is a presentation of state and never a source of truth for it.
- **Camera**: `ArcRotateCamera` in `ORTHOGRAPHIC_CAMERA` mode, fixed isometric 3/4 angle (alpha ≈ -π/2, beta ≈ π/3.5). Orthographic so tiles read as clean squares. Orbit/zoom stay attached for dev convenience.
- **Tile lookup is math, not mesh-picking** — `screenToTile` intersects a camera ray with the `y=0` plane. Babylon's `scene.pick()` on pointer-move is gated behind `constantlyUpdateMeshUnderPointer`; the math version has no such gate and doesn't care what's rendered.
- Terrain is one merged mesh, vertex-colored per tile. Grid lines are a `LineSystem` overlay. Highlights are parameterized single-tile meshes.
- ⬜ **Animation should be driven by the server's result**, not by the command the client sent. Today `GameCanvas` animates the `MoveAction` it constructed.
- ⬜ **`GameRenderer.syncUnits(state)`** — reconciles meshes against current state. It currently builds every unit mesh once at startup with no add/remove, so the first kill would leave a mesh on the board forever.
- **`renderer.ts` is the accumulation point** — every feature so far has added wiring there. Not a problem yet, worth watching.

## Dev tooling ✅

Babylon Inspector as a dev-only toggle. Pattern: gate behind `import.meta.env.DEV` and load the package via a dynamic `import()` *inside* that guard, never a static top-level import — that combination lets the bundler prove the branch is dead and strip it. Verified: no Inspector UI code in `dist/`, bundle size unchanged.

## Open questions

- **Counter-attack for `min > 1` units.** "No counter given or received" was settled when indirect fire and immobility were the same thing. Now that `canMoveAndAttack` is independent of range category, it's worth re-checking whether the rule should still key off `min > 1` alone. Probably still correct — nothing has challenged it — but never explicitly revisited.
- **No automated tests**, despite `shared/` being pure functions designed for exactly that. `applyMove`, `applyEndTurn`, `handleTileClick`, `getReachableTiles` all take plain data and return plain data. The architectural claim is real; it's unexercised.

## Known compromises

Things we've decided to live with, recorded so they don't get forgotten rather than because they're acceptable forever. Distinct from *Out of scope for v1* below, which is unbuilt features rather than shortcuts taken.

| | Current state | What it needs eventually |
|---|---|---|
| **Session identity** | Opaque localStorage id, spoofable | Real accounts + auth |
| **`actor` under hot-seat** | Server stamps `currentTurn` on its one connection | Connection→player map established at join |
| **Match persistence** | In-memory; server restart loses the game | Durable log storage |
| **One match** | A single global match, no match ids | Match registry, lobby |
| **Async play** | Both clients assumed live | Log replay for a player who was offline |
| **Ruleset versioning** | None | Stamp a ruleset id on the match so old logs replay under the rules they were played with |
| **Reconnect mid-turn** | Nothing | Falls out of `Last-Event-ID` + `seq` once the log exists |
| **Shared build step** | TS source consumed directly, bun-only | A build if the server ever moves off bun |
| **`strict` is off** | Inherited from the Vite template — `noUnusedLocals` etc. are on, but `strictNullChecks` and friends are not | Turn it on as its own increment and fix the fallout |

## Out of scope for v1

- **Transports.** `Unit.position` becomes `{ kind: 'onBoard'; coordinate } | { kind: 'carried'; by: string }` so the invalid state is unrepresentable, with cargo derived by query rather than stored on the transport.
- **Buildings / capture points.** A terrain type with attached `{ owner, captureProgress }`, not a separate object layered on a tile.
- **Graying out acted units.** The mechanical restriction is in scope; the visual is a later UI pass.
- **Manual routing.** Dragging out a deliberately non-optimal path. Unblocked by the protocol carrying a path and the server validating it — purely a matter of building the UI for it.

## Roadmap

### Networking

1. ✅ ~~**Monorepo restructure**~~ — `packages/{shared,server,client}`, bun workspaces, root scripts.
2. **`GameServer` interface + in-process implementation** — `GameCanvas` stops owning `GameState`, `submit` goes async, `actor` lands on every action with the reducer checks. Events become the reducer's output channel. Still one process.
3. **Real server** — Bun.serve, POST `/commands` + SSE `/events`, event log with `seq`, session id. Swap the interface implementation; `GameCanvas` doesn't change.

### Then combat

4. **`UnitType` catalog** — migrate `Unit.movementRange` onto it.
5. **`Unit` gains `health`/`maxHealth`** and `unitTypeId`; update the four starting units.
6. **`UnitActionCommand`** replaces `MoveCommand` — path + optional attack, atomic. `validatePath` and `findPath` join `shared/`; `canAttack` joins `legality.ts`; resolution joins the reducers.
7. **`GameRenderer.syncUnits(state)`** — required before combat can kill anything.
8. **Attack in `handleTileClick`** — clicking an enemy while selected becomes a real action, plus an attack-range overlay.

Events land in step 2 (as the reducer's output channel) and get broadcast in step 3, ahead of the second client rather than alongside it.

## Verification

`bun run lint` and `bun run build` after any change — both must stay clean, and both exit non-zero on failure (verified, not assumed).

`build` is `tsc -b && bun run --filter '@aw/client' bundle`: one typecheck pass across all packages in dependency order, then bundle. `bun run typecheck` is the `tsc -b` half alone.

`noUnusedLocals` / `noUnusedParameters` are on, and `verbatimModuleSyntax` requires explicit `import type`. Note `strict` is **not** on — see Known compromises.

**Typechecking uses project references with declaration output.** `shared` is `composite` with `emitDeclarationOnly`, writing `.d.ts` to a gitignored `dist-types/`; `server` and `client` reference it with `disableSourceOfProjectReferenceRedirect`, so they typecheck against those declarations rather than re-reading source. Two reasons this is worth the artifacts:

- **An error in `shared` is reported once, not once per package that imports it.**
- Incremental caching actually works — `noEmit` everywhere made every project look perpetually out of date.

This does not reintroduce a runtime build step: package `exports` still point at `src/*.ts`, and both Vite and bun load the TypeScript directly. `dist-types/` is consumed only by `tsc`.

Ordering matters as a result — `server` cannot typecheck before `shared` has emitted. That's why `build` runs a single root `tsc -b` rather than fanning out per package; the fan-out could run `server` first and fail cold with `TS6305`. Per-package `build` scripts are `tsc -b`, which resolve their own references correctly when run alone.

For anything visual, run the dev server and check in a browser. Hot reload usually suffices, but hard-reload if something that worked stops — Babylon's engine/scene lifecycle doesn't always survive HMR cleanly.
