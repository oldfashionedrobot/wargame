# Advance Wars Clone — Architecture

Turn-based strategy game, American Revolutionary War theme — infantry, cavalry, artillery rather than tanks and jets. React + TypeScript + Babylon.js, built with bun.

Hot-seat is the current mode — one client driving both players, and no server process yet. Networked multiplayer is the end goal, so the server/client split exists in the code from the start rather than being retrofitted; phase 3 is what makes it a real process boundary.

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
          protocol.ts  🚧 GameServer / CommandResult ✅ · HTTP request + response shapes ⬜
      data/  unitTypes 🚧 · movementCost ⬜ · chargeThresholds ⬜ · damageTable ⬜
  server/     depends on shared only — owns the match
    src/index.ts    barrel
    src/  initialState ✅ · gameServer ✅ (in-process) · match ⬜ · log ⬜
          http.ts ⬜ Bun.serve — /api/* plus the client's static build
  client/     depends on shared + (temporarily) server — Vite + React + Babylon
    index.html  vite.config.ts  public/
    src/  main.tsx · index.css
          App.tsx  — owns the GameServer and the async connect; renders
                     GameCanvas once there's state to render
      game/  GameCanvas.tsx · interaction/ · render/
             net/ ⬜ the HTTP + polling GameServer implementation
```

Cross-package imports go through each package's barrel (`@aw/shared`, `@aw/server`), never into individual files.

The split is by **authority**, not subject matter:

- **`shared/`** — types, legality predicates, queries, pathfinding, the reducers, and the wire protocol. Pure functions either side may read. Reducers live here, not in `server/`: they take a state and return a new one, they never *hold* one.
- **`server/`** — the mutable state reference, roll generation, the event log, and match construction.
- **`client/`** — Babylon rendering, input, React, and (phase 3 ⬜) the `GameServer` implementation that talks HTTP.

Separate `package.json` files are the point: `server/` doesn't list Babylon or React, so a stray import is a resolution error rather than something caught in review. `shared/` having zero dependencies is the same guarantee for purity.

**No runtime build step for `shared/`** — its `exports` point at TS source. Bun runs TS natively on the server; Vite compiles it for the client. (A real build would be needed only if the server ever moves off bun.) It *does* emit `.d.ts` for typechecking — see Verification.

**Dependency rule** — now enforced by package boundaries rather than convention:

- `shared/data/` imports nothing from the rest of `shared/`
- `shared/` imports from `shared/data/` only
- `server/` and `client/` both import from `shared/`; neither imports the other

Bun installs these *isolated* rather than hoisted — `packages/server/node_modules/` contains only `@aw/shared`, so a stray `import 'react'` there is a hard resolution failure rather than something caught in review.

*Temporary exception*: `client` depends on `@aw/server` for `createInitialState` and `createLocalGameServer`. Phase 2 **deepened** this rather than removing it, necessarily — the in-process authority lives in `@aw/server`, so the client has to construct one. It goes away in **phase 3**, when the client builds an HTTP implementation locally and takes the `GameServer` interface from `shared` instead.

## Invariants

1. ✅ **Exactly one mutable `GameState` reference exists, and `server/` owns it.** Everyone else holds immutable snapshots — `GameCanvas`'s `useState` is a render replica fed by `subscribe`, and anything needing the authoritative value calls `getState()`.
2. ✅ **`shared/` is pure** — no I/O, no RNG, no Babylon, no React, no `Date.now()`.
3. ✅ **`GameServer.submit()` is async**, from the first version — sync-to-async is a retrofit that touches every call site.
4. ✅ **`GameState` is JSON-serializable** — no `Map`, `Set`, class instances, `Date`, or functions reachable from it.
5. ✅ **Reducers validate their own input.** Legality is checked inside the reducer, never assumed from the caller. Reducers return `{ ok: true; state; events } | { ok: false; reason }`, and check `action.actor === state.currentTurn` before anything else.
6. ✅ **Single source of truth, derive the rest.** A unit's position lives only in `unit.position`. Tile occupancy, selection, transport cargo — all derived by querying `state.units`.
7. ✅ **Ephemeral UI state stays out of `GameState`** — hover, selection, camera, animation progress.
8. ✅ **The client never resolves game outcomes** — no rolls, no damage math, no combat resolution. It submits commands and renders the events it gets back. *(Structurally in place; genuinely exercised only once combat introduces an outcome worth resolving.)*

   It *may* read any deterministic part of `shared/` to **preview** — what's selectable (`legality.ts`), where a unit can move (`reachableTiles.ts`, already driving the blue overlay), what it could attack from there. That's consulting the rulebook for UI affordance, not deciding anything, and the server re-checks all of it as the actual enforcement.

   The line is **deterministic preview, yes; random resolution, no.**

## Server model 🚧

Pure server authority, no client-side prediction. An ordinary SaaS request/response app that happens to draw a battlefield: the client submits a command, waits, and renders what comes back.

**No hidden information.** Modelled on tabletop wargames — every player sees the whole board. No fog of war, ever; it isn't a deferral, it's out of scope.

### Three types, three jobs

| | Direction | Contents |
|---|---|---|
| **`Command`** | client → server | Intent only. No actor, no dice. Can be rejected. |
| **`Action`** | inside the server | `Command` + the `actor` the server attached + any rolls it generated. What reducers consume. |
| **`GameEvent`** | server → clients | A fact that already happened. What clients fetch and animate. |

The server authenticates a command into an action, validates it, resolves it, and emits events. Keeping `Command` and `Action` distinct is what stops a client from supplying its own `actor` or its own dice — those fields exist only on the type the client can't send.

Events, not actions, are what clients receive: a client that renders facts needs no rule parity with the server, so a stale browser tab can't compute a divergent outcome, and animation gets its ordered sequence — move, hit, death — without re-running resolution in the renderer.

### Command shape ⬜ *(step 8 — today it's `MoveCommand | EndTurnCommand`)*

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

**Plain HTTP request/response. No SSE, no WebSockets, no server push at all.** Commands are inherently request/response, so the POST response *is* the answer, including the rejection reason. "Another player did something" is discovered by asking.

```
POST /api/commands       → { ok: true, seq, events, state } | { ok: false, reason }
GET  /api/events?since=N → { seq, events, state }  — everything after seq N
GET  /api/state          → current state (initial load, and curl-able)
```

**Why not push.** A push channel is the only thing that would require a process holding connections open, and it buys very little here: an opponent takes tens of seconds to move, so seeing it a second or two late is imperceptible. Dropping it deletes an entire category of work — stream lifecycle, disconnect cleanup, heartbeats, proxy buffering, reconnect handling — none of which existed for any reason except the open connection.

It also leaves the door open to stateless handlers behind a data store, since nothing then needs to stay alive between requests.

**Polling is `GET /api/events?since=N`.** The client keeps the last `seq` it saw and asks for everything after it — routine polling, catch-up after a laptop sleeps, and recovery from a missed response are all the same call. **The event log *is* the polling primitive**, which is why this costs nothing to build.

First load uses `GET /api/state`, which returns state plus its `seq` — there are no events to animate on arrival, only a board to draw. `/api/events?since=N` is for everything after that.

Interval: a couple of seconds while it's the opponent's turn, and back off when the tab is hidden. There's nothing to poll for during your own turn, since only you can change anything.

**Everything is same-origin, in dev and in production alike**, so there is no CORS anywhere and the client has no URL to configure — it calls `/api/*` relative in both environments and the code is identical. See Deployment.

**Commands must be validated at runtime, not just typed.** TypeScript is erased; a POST body is attacker-controlled and can be anything. `shared/protocol.ts` gets a `parseCommand(input: unknown): Command | null` that checks the object shape and field types, and the HTTP handler rejects with 400 before the authority sees it. Hand-rolled — the command union is tiny and a schema library would be the package's first dependency.

`applyAction` also needs an exhaustive `default` returning `{ ok: false, reason }`. Today its switch returns `undefined` for an unknown `type`, and the caller throws reading `.ok` off it — verified, not theoretical. Types make that unreachable in-process and guarantee nothing over a wire.

- Both events *and* resulting state come back together. Events drive animation; state is the truth to snap to afterward. Under a kilobyte, and it makes the client self-correcting — a missed event is fixed by the next poll rather than desyncing silently.
- **`seq` makes the double-apply problem disappear.** The acting client applies its own POST response, then records that `seq`; the next poll returns nothing new because it asks for everything *after* it. No dedup logic, and no need for the subscribe-only rule that push required.
- Bun serves this with no dependencies. HTTP/2 comes free from any reverse proxy at deploy time; the app server doesn't need it.

### Deployment ⬜

**The server serves the client build.** `Bun.serve` handles `/api/*` and serves `packages/client/dist` for everything else — one process, one port, one deploy.

Since a persistent process is required regardless (below), having it also serve a small static bundle costs nothing and collapses the rest of the problem — no CORS, no client URL config, no second deploy, no dev/prod origin mismatch.

Splitting the client onto a static host, or putting a reverse proxy in front of both, becomes worth considering when the client outgrows this or CDN edge caching starts to matter. Neither is close.

**The one remaining reason the process must stay alive is in-memory state**, not the transport. Request handling is genuinely stateless — read state, validate, resolve, write, return — and dropping push removed the only thing that needed a connection held open.

So the step to *fully* stateless handlers is now just **a data store**, with no further redesign: the same endpoints, the same reducers, the same client. Nothing would need to stay alive between requests.

In-memory through phase 3 for exactly one reason: **it needs no store**, and the server only runs locally. Phase 4 changes that — see Data store.

**In dev, Vite proxies `/api` to the server** so the same relative paths work:

```ts
// vite.config.ts
server: { proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } } }
```

Ordinary request/response through a proxy is unremarkable — the buffering and streaming hazards that made this worth worrying about disappeared with push.

### Running it ⬜

Two processes in dev, one in production.

| | |
|---|---|
| `packages/server` | `"dev": "bun --watch src/http.ts"` · `"start": "bun src/http.ts"` |
| `packages/client` | `"dev": "vite"` (unchanged) |
| root | `"dev": "bun run --filter '@aw/client' --filter '@aw/server' dev"` — runs both in parallel |

Filter both explicitly rather than `'*'` — `@aw/shared` has no `dev` script.

Config surface is one knob: **`PORT` on the server**, defaulting to 3001. The client has none, because same-origin means it never needs a base URL.

Note `bun --watch` restarts on every edit, and the match lives in memory — so **editing server code resets the game in progress.** Fine now; it's the first thing durable storage would fix.

### The `GameServer` interface

Lives in `shared/protocol.ts` — both sides need it, and phase 3's client-side HTTP implementation must not have to import `@aw/server`. `GameCanvas` talks only to this and never learns what's behind it:

```ts
interface GameServer {
  getState(): GameState
  submit(command: Command): Promise<CommandResult>
  subscribe(onUpdate: (events: GameEvent[], state: GameState) => void): () => void
}
```

`getState()` is kept for debugging and for reads that need the authoritative value rather than a render replica. It is **synchronous**, which has a consequence worth stating plainly:

**A remote implementation cannot have state at construction time.** It needs a round trip first. So `App` owns the async bootstrap — it constructs the server, awaits the initial state, and renders `GameCanvas` only once ready, passing the server in as a prop. `GameCanvas` stops constructing its own authority and becomes a pure consumer of one.

That is the better shape regardless (a component shouldn't create the thing it talks to), and it's what makes "phase 3 doesn't change `GameCanvas`" nearly true instead of false — the loading state lives one level up.

**The `seq` guard lives inside the implementation, not in `GameCanvas`.** The remote `GameServer` tracks the highest `seq` it has delivered and drops anything at or below it, from either source — its own `submit` response or a poll. Callers of `subscribe` see each update exactly once and never learn that `seq` exists.

This matters because it's the difference between "phase 3 doesn't change `GameCanvas`" being true or false. If the component tracked `lastAppliedSeq`, it would need rewriting; keeping the guard in the implementation means the component stays a dumb consumer.

The guard is doing real work: a poll already in flight when you submit can return the same events the POST response is about to deliver. State is idempotent so a double-apply is invisible, but **events are not** — the unit would animate its move twice.

Applying its own `submit` response immediately is what keeps your own moves responsive rather than waiting for the next poll interval.

### Identity ⬜

Server issues an opaque id on first contact and sets it as a cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production only (dev runs over plain `http://localhost`).

**The client never touches it.** The browser returns it automatically, so there is no token to read, store, or attach — less client code than a `localStorage` scheme, not more, and nothing to migrate when phase 5 makes the session mean something. Same-origin makes this work with no CORS involved, in dev through the Vite proxy as well.

`SameSite=Lax` is what covers CSRF, which is the risk cookies introduce and bearer tokens don't. The trade is deliberate: `localStorage` is immune to CSRF but readable by any XSS, and for a same-origin app an `HttpOnly` cookie is the better side of it.

**Phase 3: identity, not authentication** — anyone can send any id. Fine while it's one local client driving both players.

`actor` is attached by the server from that identity, **never read from the client payload**. Under hot-seat one connection drives both players, so the server stamps `actor = state.currentTurn` on whatever arrives. A deliberate concession, not a security model.

**Phase 5: OAuth only, sessions in our own database. No passwords, ever.**

Sign in with a provider (Discord is the natural fit for a game; GitHub or Google work the same way). Store `(provider, external_id) → player_id`, issue our own session token into a `sessions` table, and resolve it to a `PlayerId` per request.

The point of never accepting a password is that it deletes the parts of auth that are both hardest and most dangerous — hashing, reset flows, verification email, breach response. We never hold a credential worth stealing. A **magic link** is the natural later addition for people who don't want a third-party account; it keeps the same property.

A small OAuth library plus a sessions table, not an auth platform. Hosted providers (Clerk, WorkOS, Auth0) stay a contained swap if auth ever becomes a distraction.

**The transport doesn't change** — it's the same cookie phase 3 already sets. What changes is what the session *means*: a row in `sessions` tied to a real player record, rather than an opaque id the server trusts on sight.

Whatever provides identity, **it resolves to a `PlayerId` in one place on the server**, before `actor` is stamped. Auth is a lookup in front of the authority, never something the reducers know about — and game rules never move into the database layer, whatever the store turns out to be.

## Data store ⬜ *(phase 4)*

In-memory through phase 3. That's deliberate — the server runs locally, and a restart losing the match is an accepted cost while it's only you.

**SQLite locally, Turso when deployed — the same code either way.** Use the libSQL client rather than `bun:sqlite` directly: it behaves identically against a local file, and pointing it at a hosted Turso database is a connection string rather than a rewrite. Turso is the destination because it removes the two things that actually bite about SQLite in production — ephemeral disks wiping the file on redeploy, and being pinned to a single machine.

Start with the local file. Nothing has to change to move.

```sql
matches      (id, created_at, initial_state JSON, current_state JSON, current_seq)
log_entries  (match_id, seq, action JSON, events JSON, created_at,
              PRIMARY KEY (match_id, seq))
```

State goes in as **JSON blobs** — nothing ever queries inside them, and invariant 4 already guarantees they survive the round trip. A rule written for the wire pays off again here.

**`PRIMARY KEY (match_id, seq)` is doing real work**, not just identifying rows. Two commands racing to write seq N: one insert wins, the other violates the constraint and retries against fresh state. That's serialization without locks, and it starts mattering exactly when phase 5 introduces a second human.

The schema is identical on Postgres, so the engine stays a swap rather than a redesign.

**Set the pragmas.** WAL mode (concurrent readers alongside one writer) and `busy_timeout` (contention retries instead of throwing `SQLITE_BUSY`). Defaults are meaningfully worse and this is easy to not know about.

### Deploying SQLite ⬜

Known costs, none of them surprises later if they're written down now:

- **Ephemeral filesystems are the real hazard.** Railway, Render, Cloud Run, Vercel, and friends hand you a disk that vanishes on redeploy — and the app cheerfully creates a fresh empty database rather than failing loudly. Needs an attached volume, or a hosted database. Fly.io with a volume, a persistent disk on Render/Railway, or a plain VPS all work.
- **One instance, structurally.** No horizontal scaling, and every deploy is stop-then-start rather than rolling — anyone mid-match sees a few seconds of errors.
- **Backups are yours.** Litestream (continuous replication to S3-compatible storage) is the standard answer.
- **`bun:sqlite` is synchronous**, so a slow query blocks the event loop. Irrelevant for primary-key lookups on a tiny table; it matters only for maintenance like `VACUUM`.

Moving to Turso or Postgres is what buys multi-instance and ephemeral-disk tolerance. Neither is close to necessary.

## Event log ⬜

The match is an initial state plus an ordered log of validated changes. Current state is derivable from it, though the server also keeps it materialized.

```ts
interface LogEntry {
  seq: number           // monotonic per match; the cursor for reconnect
  action: Action        // the command as authenticated: + actor, + rolls
  events: GameEvent[]   // what happened — the replayable record
}
```

The action is kept for audit — who tried what, and what the dice said. Events are what replays and what clients receive.

**Materialize, don't fold.** The server holds current state in memory *and* appends to the log. Folding the whole log on every command is O(n) per action to save a kilobyte. The log is for replay, audit, and reconnect catch-up.

In-memory through phase 3; phase 4 moves it into SQLite. See Data store.

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

Command       MoveCommand | EndTurnCommand                      ✅
              UnitActionCommand (move + optional attack)        ⬜ replaces MoveCommand
Action        Command & { actor: PlayerId }                     ✅
              + rolls                                          ⬜ arrives with combat
ActionResult  { ok, state, events } | { ok: false, reason }      ✅
GameEvent     UnitMovedEvent | TurnEndedEvent                   ✅
              damage / death / charge outcomes                  ⬜
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

## Rendering 🚧

- `client/render/` is a presentation of state and never a source of truth for it.
- **Camera**: `ArcRotateCamera` in `ORTHOGRAPHIC_CAMERA` mode, fixed isometric 3/4 angle (alpha ≈ -π/2, beta ≈ π/3.5). Orthographic so tiles read as clean squares. Orbit/zoom stay attached for dev convenience.
- **Tile lookup is math, not mesh-picking** — `screenToTile` intersects a camera ray with the `y=0` plane. Babylon's `scene.pick()` on pointer-move is gated behind `constantlyUpdateMeshUnderPointer`; the math version has no such gate and doesn't care what's rendered.
- Terrain is one merged mesh, vertex-colored per tile. Grid lines are a `LineSystem` overlay. Highlights are parameterized single-tile meshes.
- ✅ **Animation is driven by the authority's events**, not by the command the client sent — `GameRenderer.playEvents(events)` walks the list the server returned and animates each in order.
- ⬜ **`GameRenderer.syncUnits(state)`** — reconciles meshes against current state. It currently builds every unit mesh once at startup with no add/remove, so the first kill would leave a mesh on the board forever.
- **`renderer.ts` is the accumulation point** — every feature so far has added wiring there. Not a problem yet, worth watching.

## Dev tooling ✅

Babylon Inspector as a dev-only toggle. Pattern: gate behind `import.meta.env.DEV` and load the package via a dynamic `import()` *inside* that guard, never a static top-level import — that combination lets the bundler prove the branch is dead and strip it. Verified: no Inspector UI code in `dist/`, bundle size unchanged.

## Open questions

- **Counter-attack for `min > 1` units.** "No counter given or received" was settled when indirect fire and immobility were the same thing. Now that `canMoveAndAttack` is independent of range category, it's worth re-checking whether the rule should still key off `min > 1` alone. Probably still correct — nothing has challenged it — but never explicitly revisited.
- **No automated tests**, despite `shared/` being pure functions designed for exactly that. `applyMove`, `applyEndTurn`, `handleTileClick`, `getReachableTiles` all take plain data and return plain data. The architectural claim is real; it's unexercised.

Neither of the items below belongs to a phase, which is how things stay recorded forever. Both are self-contained and can be picked up between phases:

- **Turn on `strict`.** Its own increment, because the fallout is unpredictable — see Known compromises.
- **A test suite for `shared/`.** The reducers, legality predicates, and pathfinding are already pure; phase 2's contract was verified with a throwaway script that should have been a test file.

## Known compromises

Things we've decided to live with, recorded so they don't get forgotten rather than because they're acceptable forever. Distinct from *Out of scope for v1* below, which is unbuilt features rather than shortcuts taken.

| | Current state | What it needs eventually |
|---|---|---|
| **Session identity** | Opaque id in an httpOnly cookie; the server trusts it on sight | Phase 5 — OAuth sign-in and a real session record. Same cookie, real meaning. No passwords at any point |
| **`actor` under hot-seat** | Server stamps `currentTurn` on its one connection | Phase 5 — session→player map established at join |
| **Match persistence** | In-memory; server restart loses the game | Phase 4 — see Data store. The only thing still requiring the process to stay alive between requests |
| **One match** | A single global match, no match ids | Match registry, lobby |
| **Async play** | Both clients assumed live | Mostly free once the log persists — a returning player polls `?since=N` and catches up. Needs match lifecycle more than it needs new mechanics |
| **Ruleset versioning** | None | Stamp a ruleset id on the match so old logs replay under the rules they were played with |
| **Reconnect mid-turn** | Nothing | Falls out of `GET /api/events?since=N` once the log exists — the client just asks again from where it left off |
| **Shared build step** | TS source consumed directly, bun-only | A build if the server ever moves off bun |
| **`strict` is off** | Inherited from the Vite template — `noUnusedLocals` etc. are on, but `strictNullChecks` and friends are not | Turn it on as its own increment and fix the fallout |

## Out of scope for v1

- **Transports.** `Unit.position` becomes `{ kind: 'onBoard'; coordinate } | { kind: 'carried'; by: string }` so the invalid state is unrepresentable, with cargo derived by query rather than stored on the transport.
- **Buildings / capture points.** A terrain type with attached `{ owner, captureProgress }`, not a separate object layered on a tile.
- **Graying out acted units.** The mechanical restriction is in scope; the visual is a later UI pass.
- **Manual routing.** Dragging out a deliberately non-optimal path. Unblocked by the protocol carrying a path and the server validating it — purely a matter of building the UI for it.

## Roadmap

### Networking

**Where this actually stands: there is still no server process.** `@aw/server` is a library the client imports and Vite bundles — `initialState`'s `player-blue` is literally inside the client's production JS. No `Bun.serve` and no `fetch` exists in the repo.

What phases 1 and 2 bought is the *shape*, not the separation. The authority is real in the sense that one object owns state, stamps `actor`, and hands out snapshots — `GameCanvas` genuinely cannot mutate the game any more. But that object is a function call away, in the same process, and `submit` resolves before it returns. Phase 3 replaces the implementation with one that talks HTTP; nothing above the interface should notice.

1. ✅ ~~**Monorepo restructure**~~ — `packages/{shared,server,client}`, bun workspaces, root scripts.
2. ✅ ~~**`GameServer` interface + in-process implementation**~~ — `GameCanvas` stopped owning `GameState`, `submit` is async, `actor` lands on every action with reducer checks, events are the reducer's output channel. Still one process, still bundled, still no network. Beyond plan: rejection reasons surface in the UI rather than the console.
3. **Real server** — Bun.serve, `POST /api/commands` + `GET /api/events?since=N` + `GET /api/state`, event log with `seq`, session cookie, `parseCommand` validation at the boundary, exhaustive `default` in `applyAction`, Vite proxy, root dev script running both processes. `App` takes over constructing the server and awaiting initial state; `client` drops its dependency on `@aw/server`. State stays in memory.

4. **Durable store** — the event log moves out of memory. See Data store. Nothing above the match abstraction changes; this is what makes a restart survivable and what removes the last reason a process must stay alive between requests.

5. **Real multiplayer** — three pieces, all of which are prerequisites rather than nice-to-haves:
   - **Match lifecycle.** Matches gain ids, and there's a way to create one and for a second person to join it. Today there is one implicit global match, which two people cannot meaningfully share.
   - **OAuth sign-in** with sessions in our own DB — see Identity.
   - **Session→player map** established at join, so `actor` comes from *who you are* rather than *whose turn it is*.

   Until all three land, two tabs share control of both players rather than being two players. Phase 3 delivers a real server, not multiplayer.

Persistence comes before multiplayer deliberately: losing a match to a restart is an annoyance alone and unacceptable once a second human is involved and you're shipping updates.

**Phase 3 must also fix these**, all of which are latent today only because the in-process `submit` resolves synchronously:

- **Requests can now fail.** A poll or a submit can time out, 500, or hit a dead server — none of which is currently representable, since an in-process call either returns or throws. The client needs a visible connection state (retrying / offline) and the poll loop needs backoff, or a dropped server looks identical to a game where nothing is happening.
- **Selection clears optimistically.** `handleTileClick`'s result is applied to the UI *before* the command is submitted, so a rejection leaves the selection cleared for an action that never happened. Safe now only because `handleTileClick` and the reducers share `legality.ts` and can barely disagree. Note `handleEndTurn` already does the opposite — it clears only on success — so the two paths need reconciling either way.
- **No in-flight guard.** Two rapid clicks both read the same state and submit against it. Today the second sees fresh state because `submit` updates synchronously before resolving; over a network it won't. The server rejects the stale one, so this is a UI-correctness bug (a movement overlay that was already invalid), not a state-corruption one.
- **State commits before animation finishes.** `subscribe` calls `setGameState` and then starts the tween. Harmless while React only renders the turn indicator and Babylon owns the units — but `syncUnits(state)` (step 9) will snap meshes to their destination mid-tween. Whichever lands first has to account for the other.

**Why 2 and 3 are separate.** Phase 2 changes the *shape* — who owns state, what a call site looks like, sync vs async. Phase 3 changes the *transport*. Collapsing them means any breakage has two candidate causes; kept apart, a phase 3 failure is necessarily the transport.

Expect phase 2 to feel like ceremony: an async `submit` that resolves immediately, and an `actor` check that's a tautology because one connection drives both players. Both are exactly why nothing above them has to change in phase 3.

### Then combat

Combat depends on none of phases 4–5 — it can proceed as soon as phase 3 lands, or in parallel.

6. **`UnitType` catalog** — migrate `Unit.movementRange` onto it.
7. **`Unit` gains `health`/`maxHealth`** and `unitTypeId`; update the four starting units.
8. **`UnitActionCommand`** replaces `MoveCommand` — path + optional attack, atomic. `validatePath` and `findPath` join `shared/`; `canAttack` joins `legality.ts`; resolution joins the reducers.
9. **`GameRenderer.syncUnits(state)`** — required before combat can kill anything.
10. **Attack in `handleTileClick`** — clicking an enemy while selected becomes a real action, plus an attack-range overlay.
11. **Victory conditions** — a game needs an end. Elimination first: a player with no units loses, last standing wins. `GameState` gains a terminal marker (a `winner`/`outcome` field, so "finished" is a fact rather than something re-derived), `applyAction` rejects everything once set, and a `gameEnded` event tells clients to stop and show a result. Turn limits and draws sit on top of the same field.

Combat without step 11 produces a board where one side has nothing left and the game keeps accepting End Turn forever. It's a small step but it isn't optional.

Events landed in step 2 as the reducer's output channel and start being served over HTTP in step 3, ahead of the second client rather than alongside it.

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
