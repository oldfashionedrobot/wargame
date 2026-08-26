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
          protocol.ts  ✅ GameServer · CommandResult · HTTP shapes · parseCommand
      data/  unitTypes 🚧 · terrain ⬜ · damageTable ⬜ · chargeThresholds ⬜
  server/     depends on shared only — an app, not a library: no barrel
    src/  http.ts ✅ Bun.serve — /api/* plus the client's static build
          db.ts ✅ libSQL client, schema, pragmas
          match.ts ✅ MatchStore over SQLite — create/list/snapshot/since/submit
          initialState.ts ✅
  client/     depends on shared only — Vite + React + Babylon
    index.html  vite.config.ts  public/
    src/  main.tsx · index.css
          App.tsx ✅ router shell — / and /:matchId
      routes/ ✅  StartScreen (list + create) · MatchRoute (connect by id)
      net/ ✅     http.ts fetch + notFound/unreachable classification
                  matchesApi.ts list / create
                  gameServer.ts match-scoped polling GameServer
      game/       GameCanvas.tsx · interaction/ · render/
```

Cross-package imports go through `@aw/shared`'s barrel, never into individual files. The barrel holds only what `server/` and `client/` actually consume — reducers are reached through `applyAction`, union members through their union, and anything used solely inside `shared/` stays out of it.

**`@aw/server` is an application, not a library.** Nothing imports it, so it has no barrel and no `exports` field; `http.ts` is an entry point that gets run.

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

No exceptions: phase 3 removed the last one. `client` no longer lists `@aw/server` at all — it constructs an HTTP `GameServer` locally and takes the interface from `shared`.

## Invariants

1. ✅ **The database is the only mutable state. The server holds nothing between requests.** Every request reads state, computes, and writes back — there is no in-memory `GameState` anywhere in `server/`, and reintroducing a cache would break statelessness rather than satisfy this. On the client, `GameCanvas`'s `useState` is a render replica fed by `subscribe`; anything needing the authoritative value calls `getState()`.
2. ✅ **`shared/` is pure** — no I/O, no RNG, no Babylon, no React, no `Date.now()`.
3. ✅ **`GameServer.submit()` is async**, from the first version — sync-to-async is a retrofit that touches every call site.
4. ✅ **`GameState` is JSON-serializable** — no `Map`, `Set`, class instances, `Date`, or functions reachable from it.
5. ✅ **Reducers validate their own input.** Legality is checked inside the reducer, never assumed from the caller. Reducers return `{ ok: true; state; events } | { ok: false; reason }`, and check `action.actor === state.currentTurn` before anything else.
6. ✅ **Single source of truth, derive the rest.** A unit's position lives only in `unit.position`. Tile occupancy, selection, transport cargo — all derived by querying `state.units`.
7. ✅ **Ephemeral UI state stays out of `GameState`** — hover, selection, camera, animation progress.
8. ✅ **The client never resolves game outcomes** — no rolls, no damage math, no combat resolution. It submits commands and renders the events it gets back. *(Structurally in place; genuinely exercised only once combat introduces an outcome worth resolving.)*

   It *may* read any deterministic part of `shared/` to **preview** — what's selectable (`legality.ts`), where a unit can move (`reachableTiles.ts`, already driving the blue overlay), what it could attack from there. That's consulting the rulebook for UI affordance, not deciding anything, and the server re-checks all of it as the actual enforcement.

   The line is **deterministic preview, yes; random resolution, no.**

## Server model ✅ *(phase 9 extends it with real identity)*

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

### Command shape ⬜ *(step 7d — today it's `MoveCommand | EndTurnCommand`)*

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
- **Pathfinding needs no cross-machine determinism.** Because the server never re-derives a route, `exploreMovement` in `shared/` is a client-side convenience for previewing. It can use any heuristic or tie-break, and change freely, without risking disagreement. Only the cost model has to agree — see the invariant in Terrain.

What *does* have to agree is the **cost model** — the terrain table and how cost accumulates. If the client's reachable-tile overlay and the server's budget check disagree, the UI offers a move the server then rejects. That's a UX bug rather than a correctness one, and it's a much weaker constraint than identical search behaviour.

`canMoveAndAttack: false` units are rejected if `path` has more than one element.

### Transport ✅

**Plain HTTP request/response. No SSE, no WebSockets, no server push at all.** Commands are inherently request/response, so the POST response *is* the answer, including the rejection reason. "Another player did something" is discovered by asking.

```
GET  /api/matches                     → MatchSummary[]
POST /api/matches                     → MatchSummary  (creates one)

GET  /api/matches/:id/state           → { seq, state }          initial load
GET  /api/matches/:id/events?since=N  → { seq, events, state }  everything after N
POST /api/matches/:id/commands        → { ok: true, seq, events, state }
                                      | { ok: false, reason }
```

A missing match is a 404; a rejected command is still a 200 with `ok: false`, since rejection is an answer and not a transport failure.

**Why not push.** A push channel is the only thing that would require a process holding connections open, and it buys very little here: an opponent takes tens of seconds to move, so seeing it a second or two late is imperceptible. Dropping it deletes an entire category of work — stream lifecycle, disconnect cleanup, heartbeats, proxy buffering, reconnect handling — none of which existed for any reason except the open connection.

It also leaves the door open to stateless handlers behind a data store, since nothing then needs to stay alive between requests.

**Polling is `GET /api/events?since=N`.** The client keeps the last `seq` it saw and asks for everything after it — routine polling, catch-up after a laptop sleeps, and recovery from a missed response are all the same call. **The event log *is* the polling primitive**, which is why this costs nothing to build.

First load uses `GET /api/state`, which returns state plus its `seq` — there are no events to animate on arrival, only a board to draw. `/api/events?since=N` is for everything after that.

Interval: a couple of seconds normally, doubling on failure up to 30s so a dead server isn't hammered, and resetting on the next success. A failed poll costs nothing — the next one asks from the same `lastSeq`.

A hidden tab polls at the slowest interval, and a `visibilitychange` listener resets the backoff and polls immediately on return. Without that reset, restoring a tab could leave it up to thirty seconds stale while looking live.

**Everything is same-origin, in dev and in production alike**, so there is no CORS anywhere and the client has no URL to configure — it calls `/api/*` relative in both environments and the code is identical. See Deployment.

**Commands must be validated at runtime, not just typed.** TypeScript is erased; a POST body is attacker-controlled and can be anything. `shared/protocol.ts` gets a `parseCommand(input: unknown): Command | null` that checks the object shape and field types, and the HTTP handler rejects with 400 before the authority sees it. Hand-rolled — the command union is tiny and a schema library would be the package's first dependency.

`applyAction` also carries an exhaustive `default` returning `{ ok: false, reason }`. Without it the switch returned `undefined` for an unknown `type` and the caller threw reading `.ok` off it — verified, not theoretical. Types make that unreachable in-process and guarantee nothing over a wire.

**Payloads are bounded in two places**, because validating a body means allocating it first:

- `maxRequestBodySize` on `Bun.serve` (64KB) — a command is a few hundred bytes, so anything near this is a bug or an attempt to make us allocate. Rejected with 413 before parsing.
- `MAX_PATH_STEPS` in `parseCommand` — a defensive allocation bound, *not* a game rule; `validatePath` owns the real limit. Stops a path that fits under the body cap from still materialising thousands of coordinates.

Static file serving resolves against the build directory and confirms the result stays inside it. URL parsing already collapses `..`, so this is belt-and-braces — but "safe because of how the parser happens to behave" is not a property to rest filesystem access on.

- Both events *and* resulting state come back together. Events drive animation; state is the truth to snap to afterward. Under a kilobyte, and it makes the client self-correcting — a missed event is fixed by the next poll rather than desyncing silently.
- **`seq` makes the double-apply problem disappear.** The acting client applies its own POST response, then records that `seq`; the next poll returns nothing new because it asks for everything *after* it. No dedup logic, and no need for the subscribe-only rule that push required.
- Bun serves this with no dependencies. HTTP/2 comes free from any reverse proxy at deploy time; the app server doesn't need it.

### Deployment 🚧 *(dev verified; production untested)*

**The server serves the client build.** `Bun.serve` handles `/api/*` and serves `packages/client/dist` for everything else — one process, one port, one deploy.

Since a persistent process is required regardless (below), having it also serve a small static bundle costs nothing and collapses the rest of the problem — no CORS, no client URL config, no second deploy, no dev/prod origin mismatch.

Splitting the client onto a static host, or putting a reverse proxy in front of both, becomes worth considering when the client outgrows this or CDN edge caching starts to matter. Neither is close.

**Handlers are stateless.** Every request reads state from the database, computes, and writes back; nothing is held between them. Dropping push removed the only thing that needed a connection held open, and phase 4 removed the only thing that needed memory held between requests.

The process stays alive because something has to listen on a port — not because it remembers anything.

State lives in SQLite — see Data store.

**In dev, Vite proxies `/api` to the server** so the same relative paths work:

```ts
// vite.config.ts
server: { proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } } }
```

Ordinary request/response through a proxy is unremarkable — the buffering and streaming hazards that made this worth worrying about disappeared with push.

### Running it ✅

Two processes in dev, one in production.

| | |
|---|---|
| `packages/server` | `"dev": "bun --env-file=../../.env --watch src/http.ts"` · `"start"` likewise |
| `packages/client` | `"dev": "vite"` (unchanged) |
| root | `"dev": "bun run --filter '@aw/client' --filter '@aw/server' dev"` — runs both in parallel |

Both filtered explicitly for legibility; `'*'` would also work — bun skips packages that lack the script and only errors when none match.

**One `.env`, at the repo root.** Bun reads `.env` from the working directory and does not walk up, and `bun run --filter` runs with the cwd set to the package — so the server scripts pass `--env-file=../../.env` explicitly rather than each package keeping its own.

`.env.example` is committed; `.env` is not, and a missing `.env` is not an error — `--env-file` on an absent file just leaves the vars unset, so a fresh clone runs on defaults. Config surface:

| | |
|---|---|
| `PORT` | server port, default 3001 |
| `DATABASE_URL` ⬜ | `file:./aw.db` locally, a `libsql://…` URL on Turso. Read from 4a onward |

The client has none, because same-origin means it never needs a base URL.

### Client-side layering ✅

`GameServer` is scoped to **one** match — `connectGameServer(matchId)` returns a connection to that match, so listing and creating don't belong on it. Three modules under `client/src/net/`:

| | |
|---|---|
| `http.ts` | `/api` base, JSON, and the one place a response becomes `notFound` vs `unreachable` |
| `matchesApi.ts` | `listMatches()` / `createMatch()` — plain functions, no interface |
| `gameServer.ts` | the polling `GameServer` for a single match |

`net/` sits beside `game/` rather than inside it: the start screen consumes it and is not part of the game. `game/` is the Babylon canvas and the interaction on it.

Polling, `seq` dedup, and listener management stay together in `gameServer.ts` — they look like three concerns but they're one, the lifecycle of a live connection, and the dedup only makes sense next to the code producing the updates it guards.

**`MatchSummary` lives in `shared/protocol.ts`**, not `server/`. It exists so the client can render what the server sends, which makes it wire contract like `GameServer` and `CommandResult` — and the client cannot import from `@aw/server` by design.

When the server eventually needs fields the client shouldn't see — `ownerId` in phase 9 — **map explicitly, don't extend.** A server type extending the wire type is assignable to it structurally, so `JSON.stringify` ships every added field and the type system reports nothing wrong:

```ts
interface MatchRecord extends MatchSummary { ownerId }   // leaks on serialize
const toSummary = (r: MatchRecord): MatchSummary => ({ id: r.id, ... })   // cannot
```

Nothing to map today — all four fields are rendered, and `list()` already builds the shape from selected columns.

### Routing ✅

**react-router, declarative** — `<BrowserRouter>` with `<Routes>`, data loaded in effects.

Not the data router: loaders would fetch the match list before render, but **a `GameServer` needs `dispose()` and loaders have no teardown hook**. The match route would keep its effect anyway, leaving two data paradigms with the harder half unimproved. Data routers earn their keep when most routes are data-driven; here one route is a resource with a lifecycle.

| | |
|---|---|
| `/` | StartScreen — lists matches, creates one, navigates to it |
| `/:matchId` | MatchRoute — connects, renders GameCanvas |

Deep links survive a refresh in both environments already: the server falls back to `index.html` for unknown paths, and Vite's dev server does history fallback by default.

**A missing match is not a retryable error.** `connectGameServer` returns `{ ok: true; server } | { ok: false; kind: 'notFound' | 'unreachable' }` rather than throwing — the same reasoning as the reducers, that expected non-success should be representable. The two need different UI: one offers a way back to `/`, the other offers Retry, and a thrown error makes the caller reverse-engineer which it got.

### The `GameServer` interface

Lives in `shared/protocol.ts` — both sides need it, and phase 3's client-side HTTP implementation must not have to import `@aw/server`. `GameCanvas` talks only to this and never learns what's behind it:

```ts
interface GameServer {
  getState(): GameState
  submit(command: Command): Promise<CommandResult>
  subscribe(onUpdate: (events: GameEvent[], state: GameState) => void): () => void
  dispose(): void
}
```

`dispose()` is not optional bookkeeping. **Unsubscribing every listener does not stop the polling loop** — an implementation that polls runs regardless of whether anyone is listening, so whoever constructed the server has to be able to shut it down. `App` calls it from its effect cleanup, and also on a connection that resolves *after* teardown, which is exactly what StrictMode produces: a connect already in flight when the effect unmounts, leaking a second poll loop for the life of the tab if nobody disposes it.

`getState()` is kept for debugging and for reads that need the authoritative value rather than a render replica. It is **synchronous**, which has a consequence worth stating plainly:

**A remote implementation cannot have state at construction time.** It needs a round trip first. So `App` owns the async bootstrap — it constructs the server, awaits the initial state, and renders `GameCanvas` only once ready, passing the server in as a prop. `GameCanvas` stops constructing its own authority and becomes a pure consumer of one.

That is the better shape regardless (a component shouldn't create the thing it talks to), and it's what makes "phase 3 doesn't change `GameCanvas`" nearly true instead of false — the loading state lives one level up.

**The `seq` guard lives inside the implementation, not in `GameCanvas`.** The remote `GameServer` tracks the highest `seq` it has delivered and drops anything at or below it, from either source — its own `submit` response or a poll. Callers of `subscribe` see each update exactly once and never learn that `seq` exists.

This matters because it's the difference between "phase 3 doesn't change `GameCanvas`" being true or false. If the component tracked `lastAppliedSeq`, it would need rewriting; keeping the guard in the implementation means the component stays a dumb consumer.

The guard is doing real work: a poll already in flight when you submit can return the same events the POST response is about to deliver. State is idempotent so a double-apply is invisible, but **events are not** — the unit would animate its move twice.

Applying its own `submit` response immediately is what keeps your own moves responsive rather than waiting for the next poll interval.

### Identity 🚧

Server issues an opaque id on first contact and sets it as a cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production only (dev runs over plain `http://localhost`).

**The client never touches it.** The browser returns it automatically, so there is no token to read, store, or attach — less client code than a `localStorage` scheme, not more, and nothing to migrate when phase 9 makes the session mean something. Same-origin makes this work with no CORS involved, in dev through the Vite proxy as well.

`SameSite=Lax` is what covers CSRF, which is the risk cookies introduce and bearer tokens don't. The trade is deliberate: `localStorage` is immune to CSRF but readable by any XSS, and for a same-origin app an `HttpOnly` cookie is the better side of it.

**Phase 3: identity, not authentication** — anyone can send any id. Fine while it's one local client driving both players.

`actor` is attached by the server from that identity, **never read from the client payload**. Under hot-seat one connection drives both players, so the server stamps `actor = state.currentTurn` on whatever arrives. A deliberate concession, not a security model.

**Phase 9: OAuth only, sessions in our own database. No passwords, ever.**

Sign in with a provider (Discord is the natural fit for a game; GitHub or Google work the same way). Store `(provider, external_id) → player_id`, issue our own session token into a `sessions` table, and resolve it to a `PlayerId` per request.

The point of never accepting a password is that it deletes the parts of auth that are both hardest and most dangerous — hashing, reset flows, verification email, breach response. We never hold a credential worth stealing. A **magic link** is the natural later addition for people who don't want a third-party account; it keeps the same property.

A small OAuth library plus a sessions table, not an auth platform. Hosted providers (Clerk, WorkOS, Auth0) stay a contained swap if auth ever becomes a distraction.

**The transport doesn't change** — it's the same cookie phase 3 already sets. What changes is what the session *means*: a row in `sessions` tied to a real player record, rather than an opaque id the server trusts on sight.

Whatever provides identity, **it resolves to a `PlayerId` in one place on the server**, before `actor` is stamped. Auth is a lookup in front of the authority, never something the reducers know about — and game rules never move into the database layer, whatever the store turns out to be.

## Data store ✅

**SQLite locally, Turso when deployed — the same code either way.** Use the libSQL client rather than `bun:sqlite` directly: it behaves identically against a local file, and pointing it at a hosted Turso database is a connection string rather than a rewrite. Turso is the destination because it removes the two things that actually bite about SQLite in production — ephemeral disks wiping the file on redeploy, and being pinned to a single machine.

Start with the local file. Nothing has to change to move.

```sql
matches      (id, created_at, initial_state JSON, current_state JSON,
              current_seq, current_turn)
log_entries  (match_id, seq, action JSON, events JSON, created_at,
              PRIMARY KEY (match_id, seq))
```

**`initial_state` is written and never read — on purpose.** Together with the log it makes a match a complete, self-contained history; without it the log is a sequence of deltas with no anchor to replay from. It's what replays, post-mortems, and "does folding the log reproduce `current_state`?" all need. Kept now because it costs a few kilobytes once per match and **cannot be backfilled** — the starting state is exactly the thing that would be missing.

`current_turn` is denormalised out of `current_state` so listing matches doesn't parse an entire board per row just to show whose turn it is — the one field the start screen needs without loading a game.

State goes in as **JSON blobs** — nothing ever queries inside them, and invariant 4 already guarantees they survive the round trip. A rule written for the wire pays off again here.

The schema is identical on Postgres, so the engine stays a swap rather than a redesign.

### Concurrency

Once `submit` is async, two requests can interleave at `await` boundaries even in a single-threaded process — both read the same state, both compute against it, both try to write.

```
read state + seq  →  applyAction (pure)  →  batch[ INSERT log, UPDATE match ]
```

**`batch` makes the two writes atomic in one round trip.** That matters mainly for *crashes*, not races: if the process died between the insert and the update, the log would be one ahead of the materialized state and every later command would fail forever. Atomicity is worth having whether or not anyone else is writing.

**`PRIMARY KEY (match_id, seq)` catches the race for free.** It's the natural key for the log anyway, and it's what makes `WHERE seq > N` an index scan — so it isn't concurrency machinery, it's just the schema. Two writers claiming the same seq means one violates it and throws.

**A violation is left to throw.** It needs one player submitting twice inside a single round trip, which the client's in-flight guard already prevents — so it's an impossible-today condition, and impossible conditions should be loud. It surfaces as a 500 (as JSON, so the client can report it accurately) and lands in the logs. If it ever starts happening, a retry goes in exactly one place.

Explicitly *not* done: no `BEGIN IMMEDIATE` (it would hold the write lock across our own compute and network latency, for a workload that computes a pure function over a snapshot), and no in-process lock (process-local state that does nothing across instances, and would hide the condition rather than surface it).

**Set the pragmas.** WAL mode (concurrent readers alongside one writer) and `busy_timeout` (contention retries instead of throwing `SQLITE_BUSY`). Defaults are meaningfully worse and this is easy to not know about. Both are no-ops against a remote libSQL server, which manages its own concurrency.

### Deploying SQLite ⬜

Known costs, none of them surprises later if they're written down now:

- **Ephemeral filesystems are the real hazard.** Railway, Render, Cloud Run, Vercel, and friends hand you a disk that vanishes on redeploy — and the app cheerfully creates a fresh empty database rather than failing loudly. Needs an attached volume, or a hosted database. Fly.io with a volume, a persistent disk on Render/Railway, or a plain VPS all work.
- **One instance, structurally.** No horizontal scaling, and every deploy is stop-then-start rather than rolling — anyone mid-match sees a few seconds of errors.
- **Backups are yours.** Litestream (continuous replication to S3-compatible storage) is the standard answer.
- **`bun:sqlite` is synchronous**, so a slow query blocks the event loop. Irrelevant for primary-key lookups on a tiny table; it matters only for maintenance like `VACUUM`.

Moving to Turso or Postgres is what buys multi-instance and ephemeral-disk tolerance. Neither is close to necessary.

## Event log ✅

The match is an initial state plus an ordered log of validated changes. Current state is derivable from it, though the server also keeps it materialized.

```ts
interface LogEntry {
  seq: number           // monotonic per match; the cursor for reconnect
  action: Action        // the command as authenticated: + actor, + rolls
  events: GameEvent[]   // what happened — the replayable record
}
```

The action is kept for audit — who tried what, and what the dice said. Events are what replays and what clients receive.

**Materialize, don't fold.** `matches.current_state` is kept alongside the log rather than derived from it. Folding the whole log on every read would be O(n) per request to save a kilobyte of storage. The log is for replay, audit, and catch-up — not for answering "what is the board right now".

Persisted in SQLite. See Data store.

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
| `terrain.ts` | Per terrain: a single `defense` value plus `cost` per movement type, `null` = impassable. See Terrain | ⬜ |
| `chargeThresholds.ts` | `Record<AttackerUnitTypeId, Record<DefenderUnitTypeId, number>>` | ⬜ |
| `damageTable.ts` | attacker-vs-defender base damage % | ⬜ |

`TileType` moves here from `shared/types.ts` when terrain lands — it's content vocabulary, and `terrain.ts` needs it.

## Units

Three unit types, three movement types, one-to-one for now. Artillery is wheeled/horse-drawn — historically right for the era and a clean spread: infantry goes anywhere slowly, cavalry is fast but road-bound, artillery is slow *and* road-bound.

| Unit | Movement type | Ranged ⬜ | Charge ⬜ |
|---|---|---|---|
| Infantry | `foot` ✅ | musket fire | bayonet |
| Cavalry | `horse` ✅ | — | yes |
| Artillery | `wheels` ✅ | cannon | — |

Movement range, `ranged`, and `charge` are all fields on the same `UnitType` record — movement and combat aren't separate systems. The catalog currently carries identity and movement only.

## Terrain ⬜

`plains · road · bridge · forest · mountain · river · sea · beach`

**Bridge is its own type**, mechanically identical to road. The renderer has to *know* it's a bridge to draw a road crossing water, and inferring that from "road adjacent to river" is fragile — a road running alongside a river isn't a bridge. Terrain types are already a mechanics-and-presentation pair, so a presentational distinction is a legitimate reason for one.

Rivers stay meaningful: fordable on foot at a cost, impassable to wheels. `sea` and `beach` are in the list for map shape, not because naval units exist — the v1 roster is entirely land.

### One table, both axes

```ts
{ plains:   { defense: 1, cost: { foot: 1, horse: 1, wheels: 2 } },
  forest:   { defense: 2, cost: { foot: 1, horse: 2, wheels: 3 } },
  mountain: { defense: 4, cost: { foot: 2, horse: null, wheels: null } },
  river:    { defense: 0, cost: { foot: 2, horse: null, wheels: null } },
  … }
```

Defence is a **single number per terrain**, not a unit×terrain matrix — AW uses 0–5 stars at 1% per star per HP. Cost stays a matrix because it genuinely varies by movement type.

Flying units, if they ever exist, take the AW model: **no terrain defence at all** and unhindered movement. That's `defense = 0` for an air movement type, not a new dimension on the table.

One file rather than separate `movementCost` and defence tables: adding a terrain type is then one edit, and `Record` exhaustiveness covers both axes at once. Combat reads `defense` without terrain needing to know why.

### Movement is a Dijkstra, and it is the pathfinding

Cost varies per tile crossed and by who's crossing, so the terrain-blind BFS in `getReachableTiles` stops being correct. One search yields both outputs:

```ts
const movement = exploreMovement(state, unit)
movement.reachable            // the overlay
movement.pathTo(destination)  // walked back through predecessors, no second search
```

`pathTo` returns the **cheapest** route. Manual routing — deliberately taking the long way — remains possible later because the protocol carries a path and the server validates rather than derives it; it's a UI feature, not a protocol change.

### ⚠️ Invariant: one cost model

**Client and server read the same terrain table from `shared/`.** Pathfinding needs no cross-machine determinism, because the server validates rather than re-derives — but the *cost model* must agree, or the reachable overlay offers moves the server rejects. Any movement modifier added later belongs in `shared/`, never on one side.

### `validatePath` belongs here, not to combat

It is a movement rule that happens to be needed before attacking, and it fixes an **existing** hole: `path` is currently accepted unvalidated, so a client can submit a straight line through anything. That only becomes exploitable once terrain makes such a line meaningfully different from a legal route — so terrain and validation land together.

### Maps

A character grid, because then the source file looks like the map:

```ts
const MAP = [
  '..^^^..b',
  '..~~~..b',
  '--===--b',
  '..~~~..b',
  '..fff..b',
]
// . plains   - road   = bridge   ~ river
// ^ mountain f forest  b beach   s sea
```

Readable in an editor, in a diff, and in review. AW and AWBW store maps as terrain-id grids; FFT isn't a useful reference, since its 3D tiles with height solve a different problem.

**Units are a separate list**, not encoded in the grid — they carry type, owner, and facing, which doesn't fit one character:

```ts
units: [{ at: { col: 1, row: 4 }, type: 'infantry', owner: 0 }, …]
```

**Maps live in `server/maps/`.** The client never needs map *definitions* — it receives an instantiated `grid` in `GameState`. `shared/data/` is for content both sides read, and this isn't.

Consequence: `createInitialState()` becomes `createMatchState(map)`, and a match records which map it was built from.

## Combat ⬜

Modelled on Advance Wars' actual mechanics. What follows is the reference behaviour with sources, then where we intend to diverge — kept together because the divergences only make sense against what they're diverging from.

### The damage formula

Stripping CO modifiers (which we don't have), AW reduces to:

```
damage = baseDamage × (attackerHP / 10) × ((100 − terrainStars × 10 × defenderHP / 10) / 100)
```

Every step rounds down. Three things fall out of it:

- **A wounded attacker hits softer** — linearly, by HP fraction.
- **A wounded defender loses its cover.** Terrain defence scales by *defender* HP, so a 4-star mountain protects a full-health unit far more than a nearly-dead one. This accelerates kills and stops damaged units turtling on good ground.
- **Terrain is not a minor modifier.** Four stars at full health is a 40% reduction. Tuning a matchup table with defence stubbed to zero would produce numbers to throw away — which is why terrain comes first.

**Luck** adds 0 to +9 to base damage, itself scaled by attacker HP: each point of health lost narrows the luck range by 1%, floor of +1%. So damaged units are less swingy as well as weaker. *(Sources disagree slightly on where luck enters relative to the HP multiplier; the magnitude is consistent.)*

### HP representation — where we diverge ⚠️

**AW stores 100 internally and displays 1–10.** A displayed "9" is anywhere from 81 to 90. Three consequences people know the game by:

- You cannot read exact health off the board.
- **Counter-attacks reliably under-deliver** versus the preview, because the defender counters on its real internal HP while the preview used the rounded display.
- Chip damage accumulates invisibly until a bar drops.

**We keep 100 internal and display 100.** The 1–10 display was a GBA screen constraint, and inheriting it means permanently explaining why a "9 HP" unit died to 15 damage. The counter-attack surprise is arguably good texture, but it should be a choice rather than an inherited artefact.

This is upstream of the formula, the preview, the health bar, and the tuning harness — which is why it's settled here rather than discovered later.

### Terrain defence

| | Stars |
|---|---|
| Road | 0 |
| Plains | 1 |
| Woods | 2 |
| City | 3 |
| Mountain / HQ | 4 |

Each star is 10% reduction *at full defender HP*. Values live in the terrain table — see Terrain.

### Counter-attacks

**Only when both units are direct combat.** If either side is indirect, no counter in either direction. The defender counters using its post-damage HP.

Our `ranged.min === 1` ↔ direct mapping reproduces this exactly, so a counter fires iff both units have `min === 1`, the defender survives, and the attacker is within the defender's range.

**Not a special case.** A counter is `computeDamage` applied in the other direction with the defender's reduced HP — the same function, called twice. If it becomes a branch inside the attack resolver rather than a second call, that's the smell.

### Damage preview

The sharp edge of invariant 8, and AW shows one before you commit. The client computes it from the same formula with the luck term omitted — a deterministic estimate, explicitly not a prediction. The server rolls and decides the real number, which will differ. **Preview the formula, never the dice.**

### Ranged — one category, not two

```ts
ranged: { range: { min, max }, canMoveAndAttack: boolean }
```

`min === 1` behaves like AW direct fire (adjacent through max, symmetric counter-attack). `min > 1` behaves like indirect fire (can't hit adjacent, no counter given or received). The category falls out of the numbers; no separate flag.

`canMoveAndAttack` is independent of range category — a mounted archer can be indirect *and* mobile; a cannon indirect and static. AW ties these together (indirects can't move and fire); we don't, deliberately.

No line-of-sight system. AW never had one either.

### Charge

A distinct attack type, chosen instead of firing on a given turn, consuming `hasActed` either way. Capability lives on the attacker's `UnitType` (`charge?`), optional; any unit can be a *target* regardless. **This has no AW equivalent** — it's our melee model, and the one part of combat with no reference behaviour to check against.

Requires the attacker to be able to enter the target's tile — reads the terrain table, so if the target's terrain is impassable to the attacker's movement type, charge isn't available.

```
margin   = targetCurrentHP% − matchupThreshold%
luckRoll = random(0, luckMax)
success  = margin <= luckRoll
```

No clamp needed — it falls out of `luckMax` being bounded. `margin ≤ 0` always succeeds; a small positive margin needs a good roll; a margin above `luckMax` is impossible.

- **Success**: target dies, attacker displaces onto the vacated tile.
- **Failure**: attacker takes bonus damage scaled by `margin`, no position change.

Fire and charge are **different resolutions, dispatched once** on an `attackKind` discriminant — fire produces damage, charge produces death-plus-displacement or a backfire. Two self-contained functions, not conditionals threaded through one.

### Tuning

**Untuned**: `luckMax`, every charge threshold, the failure-damage scaling function, and the whole damage matchup table.

**Build the harness before tuning.** `shared/` is pure and rolls are inputs, so a script that runs the matchup grid and prints **hits-to-kill** — attacker × defender at full health on plains, then shifted by terrain — is roughly thirty lines and needs no browser. Hits-to-kill is the artefact worth tuning against; a raw damage number isn't. Without it, tuning means editing a table, restarting, creating a match, manoeuvring two units together, and reading one number.

*Sources: [Wars World News — Battle Mechanics](https://www.warsworldnews.com/wp/aw/game-aw/battle-mechanics/) · [AWBW Wiki — Damage Formula](https://awbw.fandom.com/wiki/Damage_Formula) · [Advance Wars Wiki — Luck](https://advancewars.fandom.com/wiki/Luck) · [AWBW Wiki — Terrain](https://awbw.fandom.com/wiki/Terrain) · [Advance Wars Wiki — Indirect Combat](https://advancewars.fandom.com/wiki/Indirect_Combat)*

## Rendering 🚧

- `client/render/` is a presentation of state and never a source of truth for it.
- **Camera**: `ArcRotateCamera` in `ORTHOGRAPHIC_CAMERA` mode, fixed isometric 3/4 angle (alpha ≈ -π/2, beta ≈ π/3.5). Orthographic so tiles read as clean squares. Orbit/zoom stay attached for dev convenience.
- **Tile lookup is math, not mesh-picking** — `screenToTile` intersects a camera ray with the `y=0` plane. Babylon's `scene.pick()` on pointer-move is gated behind `constantlyUpdateMeshUnderPointer`; the math version has no such gate and doesn't care what's rendered.
- Terrain is one merged mesh, vertex-colored per tile. Grid lines are a `LineSystem` overlay. Highlights are parameterized single-tile meshes.
- ✅ **Animation is driven by the authority's events**, not by the command the client sent — `GameRenderer.playEvents(events)` walks the list the server returned and animates each in order.
- ⬜ **`GameRenderer.syncUnits(state)`** — reconciles meshes against current state. It currently builds every unit mesh once at startup with no add/remove, so the first kill would leave a mesh on the board forever.
- **`renderer.ts` is the accumulation point** — every feature so far has added wiring there. Deliberately not split: when `syncUnits` lands, `unitMeshes.ts` comes out of it, following the pattern the other render modules already set.

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
| **Session identity** | Opaque id in an httpOnly cookie; the server trusts it on sight | Phase 9 — OAuth sign-in and a real session record. Same cookie, real meaning. No passwords at any point |
| **`actor` under hot-seat** | Server stamps `currentTurn` on its one connection | Phase 9 — session→player map established at join |
| **Matches are unowned and unbounded** | Anyone can create any number; no delete, no expiry. `list()` is capped at 50 newest — a bound, not pagination | Phase 9 — scope listing to the player, and add deletion. Until identity exists there's nothing to scope by |
| **Async play** | Works already — a returning client fetches current state and resumes. What's missing is knowing a match is waiting on you | Phase 9 — match lifecycle and, eventually, notification. Not new mechanics |
| **Ruleset versioning** | None | Stamp a ruleset id on the match so old logs replay under the rules they were played with |
| **Shared build step** | TS source consumed directly, bun-only | A build if the server ever moves off bun |
| **`strict` is off** | Inherited from the Vite template — `noUnusedLocals` etc. are on, but `strictNullChecks` and friends are not | Turn it on as its own increment and fix the fallout |

## Out of scope for v1

- **Transports.** `Unit.position` becomes `{ kind: 'onBoard'; coordinate } | { kind: 'carried'; by: string }` so the invalid state is unrepresentable, with cargo derived by query rather than stored on the transport.
- **Buildings / capture points.** A terrain type with attached `{ owner, captureProgress }`, not a separate object layered on a tile.
- **Graying out acted units.** The mechanical restriction is in scope; the visual is a later UI pass.
- **Manual routing.** Dragging out a deliberately non-optimal path. Unblocked by the protocol carrying a path and the server validating it — purely a matter of building the UI for it.

## Roadmap

### Shipped

1. ✅ ~~**Monorepo restructure**~~ — `packages/{shared,server,client}`, bun workspaces, root scripts.
2. ✅ ~~**`GameServer` interface + in-process implementation**~~ — `GameCanvas` stopped owning `GameState`, `submit` is async, `actor` lands on every action with reducer checks, events are the reducer's output channel. Beyond plan: rejection reasons surface in the UI rather than the console.
3. ✅ ~~**Real server**~~ — `Bun.serve` with the three endpoints, event log with `seq`, session cookie, `parseCommand` at the boundary, exhaustive `default` in `applyAction`, Vite proxy, dev script running both processes. `App` owns the connection; `GameCanvas` takes the server as a prop; `client` no longer depends on `@aw/server`.
4. ✅ ~~**Matches become real things.**~~ Split in two, because the schema wanted writing once:

   **4a ✅** Match ids; `matches` and `log_entries` in SQLite via the libSQL client; match-scoped API; `match.ts` as an async `MatchStore`; one `.env` at the repo root.

   **4b ✅** react-router (declarative); `/` start screen; `/:matchId` for the game; `connectGameServer(matchId)` returning a result rather than throwing. `net/` moved out of `game/`; `MatchSummary` moved to `shared/protocol.ts`.

**Why 2 and 3 were separate.** Phase 2 changed the *shape* — who owns state, what a call site looks like, sync vs async. Phase 3 changed the *transport*. Kept apart, a phase 3 failure was necessarily the transport. The same reasoning splits 5 from 6 below.

Three client issues stopped being latent the moment a command became a round trip, and were fixed in phase 3: requests can fail (backoff plus a visible `retrying` state), selection rolls back on rejection, and an in-flight guard stops two clicks submitting against the same stale state.

One is still latent and owned by step 7c: **state commits before animation finishes.** `subscribe` sets state and then starts the tween — harmless while Babylon owns the units, but `syncUnits` will snap meshes to their destination mid-tween.

### 5 — Client refactor

Before combat rather than during, and smaller than it first looked.

**`renderer.ts` is not split.** It's 150 lines, the sub-modules are already separate files, and what's left is wiring — which is what an assembly point is for. Splitting scene setup from the returned object would produce two files you always read together. When `syncUnits` lands in phase 7, extract `unitMeshes.ts` for mesh lifecycle and diffing and have `renderer.ts` call it, exactly as it already calls `terrain.ts` and `highlight.ts`. An extraction driven by real content, not a preemptive split.

**`GameCanvas.tsx` owns the session and the canvas at once**, which is what makes it 135 lines. Extract `useGameSession(server)` — render replica, rejection state, in-flight guard, `submitCommand`, subscription. `GameCanvas` keeps the renderer effect (it needs the canvas ref) and the JSX. One hook, not two; the split is *the session* versus *the canvas*.

**`selection.ts` stays pure.** That boundary is already right — state and a coordinate in, new state and a command out, no React and no server. It's the only genuinely testable thing in the client, and moving `submitCommand` into it would destroy that.

**Convert `SelectionState` to a union now**, even though phase 5 doesn't need the extra phases:

```ts
| { phase: 'idle' }
| { phase: 'unitSelected';      unitId; movement }
| { phase: 'destinationChosen'; unitId; movement; path }   // phase 6 adds this
```

Today it's `{ selectedUnitId: string | null; reachableTiles: Coordinate[] }` — two independently-settable fields, so "tiles with no selected unit" is representable and meaningless. Converting is the shape change, and shape changes are what this phase is for; phase 6 then adds a member rather than converting a type, and phase 7 adds `choosingTarget` the same way.

**No behaviour change.** ⚠️ And nothing verifies that beyond playing the game — this is the phase where the absent test suite is most conspicuous. A refactor without tests is worth naming as such before starting rather than after.

### 6 — Terrain and movement

Terrain and pathfinding are one system: the Dijkstra **is** the pathing, `validatePath` is meaningless without a cost table, and route preview is the same search reading its predecessors. Full spec in Terrain.

- Terrain types incl. `bridge`; one table carrying cost-per-movement-type and a single defence value
- `exploreMovement` — Dijkstra returning the reachable set and `pathTo(destination)`
- `validatePath` on the server — closes the existing unvalidated-`path` hole
- Character-grid maps in `server/maps/`; `createInitialState()` becomes `createMatchState(map)`
- Terrain rendering, and a route highlight on the chosen destination
- Confirmation step: pick destination → see route → confirm, rather than committing on click

Terrain leads because **terrain defence is not a minor modifier** — four stars at full health halves incoming damage. Tuning a matchup table with it stubbed to zero produces numbers to throw away.

Verifiable with no combat: does the overlay stop at mountains, does cavalry outrange artillery on roads, does the server reject a path through impassable terrain.

### 7 — Combat: the smallest thing you can win

Terrain and pathing already exist by this point, so the numbers mean something. The integration risk here is the chain — command → resolve → events → animate → death → mesh removal → victory — not the damage formula.

- **7a** `UnitType` catalog — migrate `Unit.movementRange` onto it. *(`unitTypes.ts` has existed unreferenced since early on.)*
- **7b** `Unit` gains `health`/`maxHealth` and `unitTypeId`; update the starting units.
- **7c** `GameRenderer.syncUnits(state)` — mesh add/remove, required before anything can die. Resolves the animation/state-commit ordering noted above.
- **7d** `UnitActionCommand` replaces `MoveCommand` — path plus optional attack, atomic. Simplest resolution: adjacent only, damage from a table, no counter-attack, no charge. Damage and death events.
- **7e** Attack in `handleTileClick` — clicking an enemy while selected becomes a real action, plus an attack-range overlay.
- **7f** Victory conditions. Elimination first: a player with no units loses. `GameState` gains a terminal marker so "finished" is a fact rather than re-derived, `applyAction` rejects everything once set, and a `gameEnded` event tells clients to stop.

Without 7f the board reaches a state where one side has nothing left and End Turn keeps working forever.

**Keep game outcome separate from lobby status.** An outcome is a fact about the board — produced by a reducer, replayable from the log — so it belongs in `GameState`. "Waiting for an opponent to join" is about *users*, belongs on the `matches` row, and no reducer should know about it. A single `status` field spanning both is the muddle to avoid.

**Build the tuning harness first.** `shared/` is pure and rolls are inputs, so a script running a thousand attacks across every matchup and printing damage distributions is roughly twenty lines and needs no browser. Without it, tuning means editing a table, restarting, creating a match, manoeuvring two units together, and observing one number. This is also the first real use of the purity invariant.

**Where identity shows up.** Two bits of UI here need to know who the user is — a "your units that can still act" indicator, and a victory screen saying *You won* rather than *Blue won*. Get it from one function rather than inlining `state.currentTurn` at each call site. Hot-seat: whoever's turn it is, because two people share one client. With auth: the session. Same concept, different source — nothing to build in advance.

Selection doesn't need it: `canSelectUnit` is a game fact ("may this unit act"), and the server already rejects a command for a unit the actor doesn't own, because `actor === currentTurn` and `unit.owner === currentTurn` compose.

### 8 — Combat depth

Counter-attacks, ranged bands (`min`/`max`), `canMoveAndAttack`, and charge with its threshold table. Layered onto a pipeline phase 6 already proved.

### 9 — Multiplayer and auth

- **Match lifecycle** — a way for a second person to join, and matches bound to users rather than open to anyone.
- **OAuth sign-in** with sessions in our own DB — see Identity.
- **Session→player map** at join, so `actor` comes from *who you are* rather than *whose turn it is*.

`resolveActor` is the only server change: it stops returning `state.currentTurn` and looks up the session. Client-side, the one function that answers "who is the user" reads it from the session instead of deriving it, and gains an ownership check so a browser doesn't offer units it can't command.

Until all three land, two tabs share control of both players rather than being two players.

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
