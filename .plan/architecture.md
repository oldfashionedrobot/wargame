# Victory or Death — Architecture

Turn-based strategy game, American Revolutionary War theme — infantry, cavalry, artillery rather than tanks and jets. React + TypeScript + Babylon.js, built with bun.

Hot-seat is the current mode — one client driving both players, against a real server process. Networked multiplayer is the end goal, so the server/client split existed in the code from the start rather than being retrofitted; phase 3 made it a real process boundary.

**This document describes the target.** Everything is marked: ✅ built · 🚧 partial · ⬜ not built. It's the single running spec — no decision history, no changelog.

**Plays end-to-end right now**: select a unit, see its movement range, move it, end turn, repeat. Two players, three units each. Everything else below is target.

## Structure ✅

Bun workspaces, three packages, no task runner on top — builds are seconds long and there's no CI to cache for. Turborepo layers on later without moving files if that changes.

```
packages/
  shared/     zero dependencies — pure rulebook, no React, no Babylon, no I/O, no RNG
    src/index.ts    barrel — the package's public surface
    src/  types · coordinate · queries · legality · reachableTiles
          action.ts ✅ validateCommand (the only Action constructor) · resolveAction
          move · endTurn  per-command validate + resolve
          applyEvents.ts ✅ the only mutator — folds events into state
          protocol.ts  ✅ GameServer · CommandResult · HTTP shapes · parseCommand
      data/  unitTypes 🚧 · terrain ⬜ · damageTable ⬜ · chargeThresholds ⬜
  server/     depends on shared only — an app, not a library: no barrel
    src/  http.ts ✅ createServer() — Bun.serve routes, /api/* plus the client build
          db.ts ✅ libSQL client + Drizzle, pragmas, migrations at boot
          const.ts ✅ the env-derived defaults, read once in one place
          schema.ts ✅ matches · resolutions, typed from shared/
          match.ts ✅ MatchStore — create/list/snapshot/since/submit
          initialState.ts ✅
    drizzle/ ✅ generated migrations + snapshots, committed
    schema.sql ✅ the whole current shape, one readable file
  client/     depends on shared only — Vite + React + Babylon
    index.html  vite.config.ts  public/
    src/  main.tsx · index.css
          App.tsx ✅ router shell — / and /:matchId
      routes/ ✅  StartScreen (list + create) · MatchRoute (connect by id)
      net/ ✅     api.ts fetch + notFound/unreachable classification, and
                         api.matches list / create
                  gameServer.ts match-scoped polling GameServer
      game/       GameCanvas.tsx · interaction/ · render/
```

Cross-package imports go through `@vod/shared`'s barrel, never into individual files. The barrel holds only what `server/` and `client/` actually consume — commands go through `validateCommand` and `resolveAction`, union members are reached through their union, and anything used solely inside `shared/` stays out of it.

**`@vod/server` is an application, not a library.** Nothing imports it, so it has no barrel and no `exports` field; `http.ts` is an entry point that gets run.

The split is by **authority**, not subject matter:

- **`shared/`** — types, legality predicates, queries, pathfinding, command validation and resolution, the event fold, and the wire protocol. Pure functions either side may read. They live here, not in `server/`: they take a state and return events or a new state, they never *hold* one.
- **`server/`** — the mutable state reference, roll generation, the event log, and match construction.
- **`client/`** — Babylon rendering, input, React, and the `GameServer` implementation that talks HTTP.

Separate `package.json` files are the point: `server/` doesn't list Babylon or React, so a stray import is a resolution error rather than something caught in review. `shared/` having zero dependencies is the same guarantee for purity.

**No runtime build step for `shared/`** — its `exports` point at TS source. Bun runs TS natively on the server; Vite compiles it for the client. (A real build would be needed only if the server ever moves off bun.) It *does* emit `.d.ts` for typechecking — see Verification.

**Dependency rule** — now enforced by package boundaries rather than convention:

- `shared/data/` imports nothing from the rest of `shared/`
- `shared/` imports from `shared/data/` only
- `server/` and `client/` both import from `shared/`; neither imports the other

Bun installs these *isolated* rather than hoisted — `packages/server/node_modules/` contains only `@vod/shared`, so a stray `import 'react'` there is a hard resolution failure rather than something caught in review.

No exceptions: phase 3 removed the last one. `client` no longer lists `@vod/server` at all — it constructs an HTTP `GameServer` locally and takes the interface from `shared`.

## Invariants

1. ✅ **The database is the only mutable state. The server holds nothing between requests.** Every request reads state, computes, and writes back — there is no in-memory `GameState` anywhere in `server/`, and reintroducing a cache would break statelessness rather than satisfy this. On the client, `GameCanvas`'s `useState` is a render replica fed by `subscribe`; anything needing the authoritative value calls `getState()`.
2. ✅ **`shared/` is pure** — no I/O, no RNG, no Babylon, no React, no `Date.now()`.
3. ✅ **`GameServer.submit()` is async**, from the first version — sync-to-async is a retrofit that touches every call site.
4. ✅ **`GameState` is JSON-serializable** — no `Map`, `Set`, class instances, `Date`, or functions reachable from it.
5. ✅ **An unvalidated action is unrepresentable.** `validateCommand` is the only constructor of an `Action` — it checks `actor === state.currentTurn` before anything else, then legality — and `resolveAction` accepts nothing else. The ordering a convention used to ask for is now enforced by the compiler: resolution cannot happen without validation having happened. `Action` carries a `unique symbol` brand that is never exported, so forging one or reviving one from JSON does not compile (verified; a deliberate `as unknown as Action` still does, which is the honest limit).

   Resolution returns **events, not state** — see invariant 9.
6. ✅ **Single source of truth, derive the rest.** A unit's position lives only in `unit.position`. Tile occupancy, selection, transport cargo — all derived by querying `state.units`.
7. ✅ **Ephemeral UI state stays out of `GameState`** — hover, selection, camera, animation progress.
8. ✅ **The client never resolves game outcomes** — no rolls, no damage math, no combat resolution. It submits commands and renders the events it gets back. *(Structurally in place; genuinely exercised only once combat introduces an outcome worth resolving.)*

   It *may* read any deterministic part of `shared/` to **preview** — what's selectable (`legality.ts`), where a unit can move (`reachableTiles.ts`, already driving the blue overlay), what it could attack from there. That's consulting the rulebook for UI affordance, not deciding anything, and the server re-checks all of it as the actual enforcement.

   The line is **deterministic preview, yes; random resolution, no.**

9. ✅ **`applyEvents` is the only thing that mutates state.** Reducers decide what happened and return events; folding them produces the next state. One mutation path, so live play and replay run the same code and `initialState + log` reproduces `currentState` by construction. Two rules bind every event: **independently applicable** to the state before it, and **absolute values, not deltas** — which is what makes applying one twice a no-op. Both are covered by tests, per event type.

## Server model ✅ *(phase 9 extends it with real identity)*

Pure server authority, no client-side prediction. An ordinary SaaS request/response app that happens to draw a battlefield: the client submits a command, waits, and renders what comes back.

**No hidden information.** Modelled on tabletop wargames — every player sees the whole board. No fog of war, ever; it isn't a deferral, it's out of scope.

### Three types, three jobs

| | Direction | Contents |
|---|---|---|
| **`Command`** | client → server | Intent only. No actor, no dice. Can be rejected. |
| **`Action`** | inside the server | A `Command` the authority has **accepted**: authenticated, checked, plus any rolls it generated. Unforgeable — see invariant 5. |
| **`GameEvent`** | server → clients | A fact that already happened. What clients fetch and animate. |

`validateCommand` authenticates and checks a command, minting an `Action`; `resolveAction` turns that into events; `applyEvents` folds them into the next state. Keeping `Command` and `Action` distinct is what stops a client from supplying its own `actor` or its own dice — those fields exist only on the type the client can't send.

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
POST /api/matches/:id/commands        → { ok: true, seq, events, state }   200
                                      | { error }                        422
```

**Status carries the outcome, not just the transport.** A missing match is 404. A body that was never a command is 400. A well-formed command the *rules* refused is **422** — distinct from both, with the reason in the body. That last one used to answer 200 with `{ ok: false, reason }` on the argument that a rejection is an answer rather than a failure; the argument is fine but it left the client unable to tell a refused move from a broken request without parsing, and it made 200 mean two things.

`MatchStore.submit` returns `CommandResult | null` — `null` for a missing match, as `snapshot` and `since` already did. That is what makes the mapping one line each: `ok: false` now means exactly one thing.

✅ **The client reads it.** A 422 surfaces as a `RejectedError` carrying the server's reason — a separate type from `HttpError`, so a rejection cannot reach the connect path's two-case UI — and `submit` returns it as `{ ok: false, reason }` without raising the reconnecting banner. Every other non-2xx reads the `ErrorResponse` body too, so a 500's reason reaches the UI verbatim, with `server returned N` as the fallback when the body is not ours.

**Every non-2xx body is an `ErrorResponse` — `{ error: string }`** — declared in `shared/protocol.ts` alongside the rest of the wire contract, with no exceptions: the client-serving path's "not built" 404 uses it too, so the rule needs no footnote. Deliberately *not* `CommandResult`'s `{ ok: false, reason }`, which the 400s and the 500 used to borrow: the two mean different things, and sharing a shape invites a client to conflate "your move was illegal" with "that was not a command". Success bodies go out through `Response.json`, which sets the content type itself.

**Dispatch is `Bun.serve`'s own `routes` table**, not hand-rolled path parsing — one entry per endpoint above, keyed by method. Params come from the path literal, so `request.params.id` is typed and a typo in it is a compile error rather than `undefined` at runtime (verified). A `'/api/*'` entry catches everything the table does not claim, including a method an endpoint does not serve, which keeps those 404 rather than 405, and a `'/*'` entry below it serves the client build. There is no `fetch` handler at all: every path is accounted for in the table, and only `routes` receive a `BunRequest` — which is what carries `cookies`.

The session cookie is the one thing this cost. `Bun.serve` has no middleware — [an open request upstream](https://github.com/oven-sh/bun/issues/17608), not an oversight here — and a matched route never reaches a fallback, so there is no choke point to stamp every response from. A `withSession` wrapper sits on each entry instead, visible on every line of the table: forgetting it is otherwise silent, since the endpoint keeps working and merely stops issuing a session.

**Why not push.** A push channel is the only thing that would require a process holding connections open, and it buys very little here: an opponent takes tens of seconds to move, so seeing it a second or two late is imperceptible. Dropping it deletes an entire category of work — stream lifecycle, disconnect cleanup, heartbeats, proxy buffering, reconnect handling — none of which existed for any reason except the open connection.

It also leaves the door open to stateless handlers behind a data store, since nothing then needs to stay alive between requests.

**Polling is `GET /api/events?since=N`.** The client keeps the last `seq` it saw and asks for everything after it — routine polling, catch-up after a laptop sleeps, and recovery from a missed response are all the same call. **The event log *is* the polling primitive**, which is why this costs nothing to build.

First load uses `GET /api/state`, which returns state plus its `seq` — there are no events to animate on arrival, only a board to draw. `/api/events?since=N` is for everything after that.

Interval: a couple of seconds normally, doubling on failure up to 30s so a dead server isn't hammered, and resetting on the next success. A failed poll costs nothing — the next one asks from the same `lastSeq`.

A hidden tab polls at the slowest interval, and a `visibilitychange` listener resets the backoff and polls immediately on return. Without that reset, restoring a tab could leave it up to thirty seconds stale while looking live.

**Everything is same-origin, in dev and in production alike**, so there is no CORS anywhere and the client has no URL to configure — it calls `/api/*` relative in both environments and the code is identical. See Deployment.

**Commands must be validated at runtime, not just typed.** TypeScript is erased; a POST body is attacker-controlled and can be anything. `shared/protocol.ts` gets a `parseCommand(input: unknown): Command | null` that checks the object shape and field types, and the HTTP handler rejects with 400 before the authority sees it. Hand-rolled — the command union is tiny and a schema library would be the package's first dependency.

`validateCommand` also carries an exhaustive `default` refusing an unknown `type`, and `applyEvents` throws on an unknown event rather than skipping it — silently ignoring one would desync a replay. An earlier switch without such a default returned `undefined` and the caller threw reading `.ok` off it — verified, not theoretical. Types make that unreachable in-process and guarantee nothing over a wire.

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
| root | `"dev": "bun run --filter '@vod/client' --filter '@vod/server' dev"` — runs both in parallel |

Both filtered explicitly for legibility; `'*'` would also work — bun skips packages that lack the script and only errors when none match.

**`http.ts` exports `createServer({ port, databaseUrl })` and starts one only under `import.meta.main`.** Running the file is what listens; importing it yields the factory and nothing else. That is what keeps the module free of side effects at import — both inputs are arguments rather than ambient environment, which is the difference between the server being testable and merely importable. Without the guard the scripts would define the factory and exit without serving (observed).

**One `.env`, at the repo root.** Bun reads `.env` from the working directory and does not walk up, and `bun run --filter` runs with the cwd set to the package — so the server scripts pass `--env-file=../../.env` explicitly rather than each package keeping its own.

`.env.example` is committed; `.env` is not, and a missing `.env` is not an error — `--env-file` on an absent file just leaves the vars unset, so a fresh clone runs on defaults. Config surface:

| | |
|---|---|
| `PORT` | server port, default 3001 |
| `DATABASE_URL` ✅ | `file:./packages/server/vod.db` locally, a `libsql://…` URL on Turso |

The client has none, because same-origin means it never needs a base URL.

### Client-side layering ✅

`GameServer` is scoped to **one** match — `connectGameServer(matchId)` returns a connection to that match, so listing and creating don't belong on it. Two modules under `client/src/net/`:

| | |
|---|---|
| `api.ts` | the `/api` base, JSON, and the one place a response becomes `notFound`, `unreachable`, or a command rejection — plus `api.matches.list()` / `.create()`, the endpoints that aren't match-scoped |
| `gameServer.ts` | the polling `GameServer` for a single match |

**The match endpoints live in `api.ts` rather than a module of their own.** They are two one-line wrappers over `getJson`/`postJson` with no state, no lifecycle, and no interface — a separate file was an import and a name for nothing. They stay off `GameServer` for the reason above, which is a different question from which file they sit in.

`gameServer.ts` is the one that stays separate, because it is the opposite kind of thing: a live connection with a poll loop, a `seq` cursor, backoff, and a `dispose()`. The split in `net/` is **stateless calls versus a connection**, not one file per endpoint group.

`net/` sits beside `game/` rather than inside it: the start screen consumes it and is not part of the game. `game/` is the Babylon canvas and the interaction on it.

Polling, `seq` dedup, and listener management stay together in `gameServer.ts` — they look like three concerns but they're one, the lifecycle of a live connection, and the dedup only makes sense next to the code producing the updates it guards.

**`MatchSummary` lives in `shared/protocol.ts`**, not `server/`. It exists so the client can render what the server sends, which makes it wire contract like `GameServer` and `CommandResult` — and the client cannot import from `@vod/server` by design.

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

Lives in `shared/protocol.ts` — both sides need it, and phase 3's client-side HTTP implementation must not have to import `@vod/server`. `GameCanvas` talks only to this and never learns what's behind it:

```ts
interface GameServer {
  getState(): GameState
  submit(command: Command): Promise<CommandResult>
  subscribe(onUpdate: (events: GameEvent[], state: GameState) => void): () => void
  dispose(): void
}
```

`dispose()` is not optional bookkeeping. **Unsubscribing every listener does not stop the polling loop** — an implementation that polls runs regardless of whether anyone is listening, so whoever constructed the server has to be able to shut it down. `MatchRoute` calls it from its effect cleanup, and also on a connection that resolves *after* teardown, which is exactly what StrictMode produces: a connect already in flight when the effect unmounts, leaking a second poll loop for the life of the tab if nobody disposes it.

`getState()` is kept for debugging and for reads that need the authoritative value rather than a render replica. It is **synchronous**, which has a consequence worth stating plainly:

**A remote implementation cannot have state at construction time.** It needs a round trip first. So `MatchRoute` owns the async bootstrap — it constructs the server, awaits the initial state, and renders `GameCanvas` only once ready, passing the server in as a prop. `GameCanvas` stops constructing its own authority and becomes a pure consumer of one.

That is the better shape regardless (a component shouldn't create the thing it talks to), and it's what makes "phase 3 doesn't change `GameCanvas`" nearly true instead of false — the loading state lives one level up.

**The `seq` guard lives inside the implementation, not in `GameCanvas`.** The remote `GameServer` tracks the highest `seq` it has delivered and drops anything at or below it, from either source — its own `submit` response or a poll. Callers of `subscribe` see each update exactly once and never learn that `seq` exists.

This matters because it's the difference between "phase 3 doesn't change `GameCanvas`" being true or false. If the component tracked `lastAppliedSeq`, it would need rewriting; keeping the guard in the implementation means the component stays a dumb consumer.

The guard is doing real work: a poll already in flight when you submit can return the same events the POST response is about to deliver. State is idempotent so a double-apply is invisible, but **events are not** — the unit would animate its move twice.

Applying its own `submit` response immediately is what keeps your own moves responsive rather than waiting for the next poll interval.

### Identity 🚧

Server issues an opaque id on first contact and sets it as a cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production only (dev runs over plain `http://localhost`).

One implementation, using bun's own cookie map. Only `routes` receive a `BunRequest`, and only a `BunRequest` carries `.cookies` — which is why the client build is a `'/*'` route rather than a `fetch` fallback. With every handler holding one, `withSession` reads and writes through `request.cookies` and never builds a `Set-Cookie` header itself; bun applies the change to the response, and does not parse the header until `cookies` is first touched.

**The client never touches it.** The browser returns it automatically, so there is no token to read, store, or attach — less client code than a `localStorage` scheme, not more, and nothing to migrate when phase 9 makes the session mean something. Same-origin makes this work with no CORS involved, in dev through the Vite proxy as well.

`SameSite=Lax` is what covers CSRF, which is the risk cookies introduce and bearer tokens don't. The trade is deliberate: `localStorage` is immune to CSRF but readable by any XSS, and for a same-origin app an `HttpOnly` cookie is the better side of it.

**Phase 3: identity, not authentication** — anyone can send any id. Fine while it's one local client driving both players.

`actor` is attached by the server from that identity, **never read from the client payload**. Under hot-seat one connection drives both players, so the server stamps `actor = state.currentTurn` on whatever arrives. A deliberate concession, not a security model.

**Phase 9: OAuth only, sessions in our own database. No passwords, ever.**

Sign in with a provider (Discord is the natural fit for a game; GitHub or Google work the same way). Store `(provider, external_id) → player_id`, issue our own session token into a `sessions` table, and resolve it to a `PlayerId` per request.

The point of never accepting a password is that it deletes the parts of auth that are both hardest and most dangerous — hashing, reset flows, verification email, breach response. We never hold a credential worth stealing. A **magic link** is the natural later addition for people who don't want a third-party account; it keeps the same property.

A small OAuth library plus a sessions table, not an auth platform. Hosted providers (Clerk, WorkOS, Auth0) stay a contained swap if auth ever becomes a distraction.

**Better Auth is the candidate to evaluate first**, because it *is* that description rather than an alternative to it: sessions in our own database, a first-class Drizzle adapter, SQLite supported, httpOnly cookies, OAuth providers, and no password path required. It would replace `resolveActor`, supply the `sessions` table, and subsume `withSession` entirely — session creation becomes an insert, which retires the concurrent-mint race rather than working around it. To check when we get there: whether its cookie replaces `vod_session` cleanly, and what it assumes about a framework, since `Bun.serve` is not one.

**The transport doesn't change** — it's the same cookie phase 3 already sets. What changes is what the session *means*: a row in `sessions` tied to a real player record, rather than an opaque id the server trusts on sight.

Whatever provides identity, **it resolves to a `PlayerId` in one place on the server**, before `actor` is stamped. Auth is a lookup in front of the authority, never something the reducers know about — and game rules never move into the database layer, whatever the store turns out to be.

## Data store ✅

**SQLite locally, Turso when deployed — the same code either way.** The libSQL client rather than `bun:sqlite` directly: it behaves identically against a local file, and pointing it at a hosted Turso database is a connection string rather than a rewrite. `drizzle-orm/libsql` *is* the Turso adapter, so that promise survives the ORM — the URL is the entire difference. Turso is the destination because it removes the two things that actually bite about SQLite in production — ephemeral disks wiping the file on redeploy, and being pinned to a single machine.

Start with the local file. Nothing has to change to move.

```sql
matches      (id, created_at, initial_state JSON, current_state JSON,
              current_seq, current_turn,
              PRIMARY KEY (id))
resolutions  (match_id, seq, actor, action JSON, events JSON, created_at,
              PRIMARY KEY (match_id, seq),
              FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE)
```

**A resolution is one accepted action and everything it produced.** That is what a row is, and what the earlier name `log_entries` never said. `actor` is promoted out of the action blob because it is the one field of an action worth filtering on — and the only record of who did something, once phase 9 makes that mean anything.

**`initial_state` is written and never read — on purpose.** Together with the log it makes a match a complete, self-contained history; without it the log is a sequence of deltas with no anchor to replay from. Kept because it costs a few kilobytes once per match and **cannot be backfilled** — the starting state is exactly the thing that would be missing.

**`current_state` is a checkpoint, not a second source of truth.** Every event-sourced system checkpoints; keeping the latest is the degenerate case, at an interval of one. It exists for `submit`, which must validate against current state and already reads that row for the concurrency guard — so reading it costs nothing extra. Measured: 0.06 ms against ~8 ms to fold 2000 entries, on a path that runs per command.

Events remain authoritative (invariant 9), and a test folds the log from `initial_state` on every run to prove the two agree. If they ever diverge, rebuild the checkpoint — the log is the truth.

`current_turn` is denormalised out of `current_state` so listing matches doesn't parse an entire board per row just to show whose turn it is — the one field the start screen needs without loading a game.

State goes in as **JSON blobs** — nothing ever queries inside them, and invariant 4 already guarantees they survive the round trip. A rule written for the wire pays off again here.

The schema is close to identical on Postgres, but not free: `created_at` holds `Date.now()`, which overflows Postgres `INTEGER` (int4) and would need `BIGINT` or `TIMESTAMPTZ`. It works in SQLite only because SQLite integers are 64-bit.

### Access ✅ *(Drizzle)*

`schema.ts` defines both tables in `drizzle-orm/sqlite-core`; queries are typed from it, so a column rename is a compile error rather than a runtime surprise. JSON columns carry `$type<GameState>()` and friends, which removes the `JSON.parse(x as string) as GameState` pattern from every call site.

Worth knowing what `$type` is: a compile-time assertion, not validation. It centralises a cast rather than performing a check. Real validation would need a validator, and the natural home would cost `shared/` its zero-dependency property.

**Migrations are generated, not hand-written.** `bun run db:generate` diffs `schema.ts` against snapshots in `packages/server/drizzle/meta/` and writes SQL; `migrate()` applies pending ones at boot. Committed, because they record what has been applied to real databases and cannot be regenerated from the schema alone. `schema.sql` is refreshed by the same script — the whole current shape in one readable file, since incremental migrations don't give you that.

Two things stay on the raw driver because Drizzle cannot express them: the pragmas, and the `'write'` transaction mode — see Concurrency.

⚠️ **`file:` paths in `DATABASE_URL` are relative to the repo root**, resolved there regardless of cwd. Two processes read the same variable from different directories — the server runs with cwd set to its own package, `drizzle-kit` runs from the root — so left to cwd, one string would mean two different files and migrations would quietly build a second, empty database beside the real one. The `db:*` scripts live at the root and do **not** use `bun run --filter`, which would set cwd to the package and lose the single root `.env`.

**The fallback itself lives once**, in `src/const.ts`: `createDb` takes it as its default, and `drizzle.config.ts` imports the same constant. There is no second literal to keep in step — drizzle-kit transpiles the config and resolves its relative imports, so reaching into the app's module graph works (verified: both `db:generate` and `db:migrate` run, and no stray database appears beside the real one).

What that does *not* remove is the cwd dependency above. `DEFAULT_DB_URL` is a repo-root-relative `file:` path; `db.ts` resolves it against `REPO_ROOT` explicitly, while drizzle-kit resolves it against cwd. They agree only because the `db:*` scripts run from the root — which is why those scripts must not move to `bun run --filter`.

### Concurrency

Once `submit` is async, two requests can interleave at `await` boundaries even in a single-threaded process — both read the same state, both compute against it, both try to write.

```
read state + seq  →  validate → resolve → applyEvents (all pure)  →  batch[ INSERT log, UPDATE match ]
```

Statements are **built by Drizzle and run by the raw driver**. Drizzle's own `batch()` cannot pass a transaction mode — it always gets libSQL's default, `deferred`, which starts as a read and upgrades on first write. `'write'` is `BEGIN IMMEDIATE`: the lock is taken up front, so the upgrade cannot fail partway through. `.toSQL()` gives typed construction *and* the mode; one cast (`bind`) bridges Drizzle's `unknown[]` params to libSQL's `InValue[]`.

**`batch` makes the two writes atomic in one round trip.** That matters mainly for *crashes*, not races: if the process died between the insert and the update, the log would be one ahead of the materialized state and every later command would fail forever. Atomicity is worth having whether or not anyone else is writing.

**`PRIMARY KEY (match_id, seq)` catches the race for free.** It's the natural key for the log anyway, and it's what makes `WHERE seq > N` an index scan — so it isn't concurrency machinery, it's just the schema. Two writers claiming the same seq means one violates it and throws.

**The `WHERE … AND current_seq = ?` guard is now asserted.** `submit` checks the update's `rowsAffected` and throws if it matched nothing. That branch cannot be reached from the API — verified by trying: twenty attempts to move the row between the read and the write fired it zero times, because libSQL serialises on one connection, and the primary key would violate first regardless. The test covers the mechanism it rests on rather than the branch, and says so.

**A violation is left to throw.** It needs one player submitting twice inside a single round trip, which the client's in-flight guard already prevents — so it's an impossible-today condition, and impossible conditions should be loud. It surfaces as a 500 (as JSON, so the client can report it accurately) and lands in the logs. If it ever starts happening, a retry goes in exactly one place.

Explicitly *not* done: no `BEGIN IMMEDIATE` (it would hold the write lock across our own compute and network latency, for a workload that computes a pure function over a snapshot), and no in-process lock (process-local state that does nothing across instances, and would hide the condition rather than surface it).

**Set the pragmas, in the two places their lifetimes belong.** WAL mode (concurrent readers alongside one writer) and `busy_timeout` (contention waits instead of throwing `SQLITE_BUSY`). Defaults are meaningfully worse and this is easy to not know about. Both are no-ops against a remote libSQL server, which manages its own concurrency.

They are not the same kind of setting, which is worth stating because pairing them looks natural and is a trap. **`journal_mode = WAL` is a property of the database file** and survives every restart, so it belongs with `migrate()` — set once. **`busy_timeout` is per connection and resets to 0 on each new one** (verified), so it belongs in `createDb`. Together in `migrate()` they worked only because every caller happened to call both; the day migrations move to a deploy step, that pairing would have taken `busy_timeout` with them and produced intermittent `SQLITE_BUSY` a long way from the change.

### Deploying SQLite ⬜

Known costs, none of them surprises later if they're written down now:

- **Ephemeral filesystems are the real hazard.** Railway, Render, Cloud Run, Vercel, and friends hand you a disk that vanishes on redeploy — and the app cheerfully creates a fresh empty database rather than failing loudly. Needs an attached volume, or a hosted database. Fly.io with a volume, a persistent disk on Render/Railway, or a plain VPS all work.
- **One instance, structurally.** No horizontal scaling, and every deploy is stop-then-start rather than rolling — anyone mid-match sees a few seconds of errors.
- **Backups are yours.** Litestream (continuous replication to S3-compatible storage) is the standard answer.
- **`bun:sqlite` is synchronous**, so a slow query blocks the event loop. Irrelevant for primary-key lookups on a tiny table; it matters only for maintenance like `VACUUM`.

Moving to Turso or Postgres is what buys multi-instance and ephemeral-disk tolerance. Neither is close to necessary.

## Match log 🚧

The match is an initial state plus an ordered log of validated changes.

Each row of `resolutions` holds one **action** and the **events** it produced, keyed by a monotonic `seq`. Three fields, three jobs:

| | | |
|---|---|---|
| `seq` | the cursor for catch-up | ✅ |
| `events` | what happened, at animation granularity | ✅ read on every poll |
| `action` | the accepted command: `+ actor`, later `+ rolls` | ⬜ written, never read — an audit record, not something to act on |

**Events are authoritative.** `applyEvents` is the only thing that mutates state, so `initialState + log` reproduces `currentState` by construction, and a test checks it over a multi-turn script and at every intermediate step. `matches.current_state` is a checkpoint, not a second truth — see below.

`GET /events?since=N` is the log's other job, and the reason push could be dropped: the log *is* the subscription mechanism, so polling cost nothing to build.

**The client deliberately does not fold.** An earlier plan had it mirroring the server with `applyEvents`; 5b settled against — the renderer animates from event payloads, and nothing else consumes intermediate states (see 5b, *Why the client does not fold*). `applyEvents` stays exported, so a replay or debug tool can fold the log any time without the live client doing so.

**Rejections are not logged.** `submit` returns before the write, so the log records what happened, never what was attempted. "Who tried what" needs failed actions stored too.

**Materialize, don't fold.** `matches.current_state` is a checkpoint rather than a second source of truth — see Data store for the reasoning and the numbers.

Persisted in SQLite. See Data store.

Events are per-change, at the granularity a client needs to animate:

```ts
type GameEvent =
  | { type: 'unitMoved'; unitId; path }
  | { type: 'unitAttacked'; attackerId; targetId; damage }
  | { type: 'unitDied'; unitId }
  | { type: 'turnEnded'; nextPlayer }
```

Resolution returns events and nothing else; state comes from folding them:

```ts
validateCommand(state, command, actor) → { ok: true, action } | { ok: false, reason }
resolveAction(state, action)           → GameEvent[]
applyEvents(state, events)             → GameState
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
ValidationResult { ok, action } | { ok: false, reason }         ✅
CommandResult { ok, seq, events, state } | { ok: false, reason } ✅
ErrorResponse { error } — the body of every non-2xx              ✅
GameEvent     UnitMovedEvent | TurnEndedEvent                   ✅
              damage / death / charge outcomes                  ⬜
```

- `PlayerId` is a plain string so player count isn't baked into the type system. Turn order is array rotation over `GameState.players`, wrapping via modulo — works for 2 or 4 players, and is where a "skip eliminated players" rule goes.
- **One `hasActed` flag**, not separate move/attack flags — one command per unit action sets it exactly once. Reset by the `turnEnded` event, for the incoming player only.
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
- ✅ ~~**`net/gameServer.ts` is untested**~~ — 22 tests as of 5a: seq deduplication (a poll in flight during a submit no longer goes unchecked), exponential backoff and its cap, the status transitions, `dispose` including a poll resolving after teardown, and — once step 5's harness landed — the hidden-tab interval and the `visibilitychange` reset. `fetch` and timers faked, happy-dom for the document.
- ✅ ~~**No automated tests.**~~ 123 of them now — 50 in `shared/`, 40 in `server/`, 33 in `client/`. `bun test` for the first two, Vitest for the third. Covers `parseCommand`, validation and resolution, `getReachableTiles`, the event fold and its two design rules, `MatchStore` against `:memory:`, the HTTP surface end to end, `handleTileClick`, and the polling `GameServer`. What is *not* covered: the renderer — WebGL, so a real browser remains the check for it.

The item below does not belong to a phase, which is how things stay recorded forever:

- ✅ ~~**The server refactor.**~~ Drizzle and real migrations, `log_entries` became `resolutions`, events made authoritative and independently applicable, `Action` became a branded validated type, and the repo got its first tests. The client-side event folding once listed as its last piece was rescoped away in 5b — see *Why the client does not fold*.

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
| **Migrations run at boot** | `migrate()` on startup, fine for one instance and ~0.4 ms once nothing is pending. Drizzle lists runtime migration as a first-class flow for monoliths, so this is a choice rather than a shortcut | `bun run db:migrate` as a deploy step, once there is more than one instance, a rolling deploy, or a reason to deny the runtime DDL rights |
| **Two reads per command** | `resolveActor` needs state to stamp `actor = currentTurn`, but `submit` owns the read | Phase 9 — `resolveActor` becomes a session lookup and the extra read disappears |
| **`typecheck` can pass stale** | `tsc -b` skips work its `.tsbuildinfo` believes current — observed reporting 0 while `tsc -p packages/server` flagged two `TS6133`s | Run `tsc -b --force` in the gate, or drop the incremental cache |

## Out of scope for v1

- **Transports.** `Unit.position` becomes `{ kind: 'onBoard'; coordinate } | { kind: 'carried'; by: string }` so the invalid state is unrepresentable, with cargo derived by query rather than stored on the transport.
- **Buildings / capture points.** A terrain type with attached `{ owner, captureProgress }`, not a separate object layered on a tile.
- **Graying out acted units.** The mechanical restriction is in scope; the visual is a later UI pass.
- **Manual routing.** Dragging out a deliberately non-optimal path. Unblocked by the protocol carrying a path and the server validating it — purely a matter of building the UI for it.

## Roadmap

### Shipped

1. ✅ ~~**Monorepo restructure**~~ — `packages/{shared,server,client}`, bun workspaces, root scripts.
2. ✅ ~~**`GameServer` interface + in-process implementation**~~ — `GameCanvas` stopped owning `GameState`, `submit` is async, `actor` lands on every action with reducer checks, events are the reducer's output channel. Beyond plan: rejection reasons surface in the UI rather than the console.
3. ✅ ~~**Real server**~~ — `Bun.serve` with the three endpoints, event log with `seq`, session cookie, `parseCommand` at the boundary, exhaustive `default` in `applyAction`, Vite proxy, dev script running both processes. `App` owned the connection (4b moved it to `MatchRoute`); `GameCanvas` takes the server as a prop; `client` no longer depends on `@vod/server`.
4. ✅ ~~**Matches become real things.**~~ Split in two, because the schema wanted writing once:

   **4a ✅** Match ids; `matches` and `log_entries` in SQLite via the libSQL client (later replaced by `resolutions`, and the hand-written SQL by Drizzle); match-scoped API; `match.ts` as an async `MatchStore`; one `.env` at the repo root.

   **4b ✅** react-router (declarative); `/` start screen; `/:matchId` for the game; `connectGameServer(matchId)` returning a result rather than throwing. `net/` moved out of `game/`; `MatchSummary` moved to `shared/protocol.ts`.

**Why 2 and 3 were separate.** Phase 2 changed the *shape* — who owns state, what a call site looks like, sync vs async. Phase 3 changed the *transport*. Kept apart, a phase 3 failure was necessarily the transport. The same reasoning splits 5 from 6 below.

Three client issues stopped being latent the moment a command became a round trip, and were fixed in phase 3: requests can fail (backoff plus a visible `retrying` state), selection rolls back on rejection, and an in-flight guard stops two clicks submitting against the same stale state.

One is still latent: **state commits before animation finishes.** `subscribe` sets state and then starts the tween — harmless while Babylon owns the units, but `syncUnits` will snap meshes to their destination mid-tween. **Step 5b owns the fix** — it gates the commit on the animation; 7c is where it stops being harmless.

### 5 — Client refactor

Before combat rather than during. **Split in two**, for the same reason phases 2
and 3 were: 5a changes shape and nothing else, 5b changes behaviour. Kept apart,
a 5a regression is necessarily the refactor.

5c is appended rather than part of that split: it is tooling, not refactor, and
nothing in 5a or 5b depends on it.

**`renderer.ts` is not split.** It's 158 lines, the sub-modules are already
separate files, and what's left is wiring — which is what an assembly point is
for. Splitting scene setup from the returned object would produce two files you
always read together. When `syncUnits` lands in phase 7, extract `unitMeshes.ts`
for mesh lifecycle and diffing and have `renderer.ts` call it, exactly as it
already calls `terrain.ts` and `highlight.ts`. An extraction driven by real
content, not a preemptive split.

#### 5a ✅ — the refactor. One behaviour change, its own commit.

**`GameCanvas.tsx` owned the session and the canvas at once**, which is what
made it 135 lines. `useGameSession(server, { onSelectionChange, onEvents })`
now owns the session — render replica, rejection state, in-flight guard,
`submitCommand`, the tile-click handler, subscription, and one `applySelection`
funnel every selection write passes through, so the
set-the-ref-then-push-the-renderer pairing lives once instead of at three call
sites. `GameCanvas` keeps the renderer effect (it needs the canvas ref) and the
JSX, imports neither `handleTileClick` nor `initialSelectionState`, and knows
three things: a canvas ref, the renderer lifecycle, and how to draw a
selection. It gets `endTurn` rather than a raw `submitCommand`, so `Command`
construction never leaves the session. One hook, not two; the split is *the
session* versus *the canvas*.

**`selection.ts` stays pure.** State and a coordinate in, new state and a command
out, no React and no server. Moving `submitCommand` into it would destroy that.

✅ **`SelectionState` became a union**, even though 5a doesn't need the extra
phases:

```ts
| { phase: 'idle' }
| { phase: 'unitSelected';      unitId; position; reachableTiles }
| { phase: 'destinationChosen'; unitId; position; reachableTiles; path }   // phase 6 adds this
```

Today it's `{ selectedUnitId: string | null; reachableTiles: Coordinate[] }` — two
independently-settable fields, so "tiles with no selected unit" is representable
and meaningless. Phase 6 then adds a member rather than converting a type, and
phase 7 adds `choosingTarget` the same way.

`position` is captured at selection time, exactly as `reachableTiles` already
is — the type becomes coherently a snapshot instead of half snapshot, half
lookup. That is what lets the selection push become a projection of the
selection alone: no `state` parameter, no choice between the render replica and
`server.getState()` to reason about. Selection is ephemeral UI state (invariant
7), not `GameState`, so snapshotting what it previews takes nothing from
invariant 6 — and phase 6's confirmation step needs snapshot semantics
regardless.

*(Phase 6 renames `reachableTiles` to `movement` when it stops being a bare array
and becomes the `exploreMovement` result with `.reachable` and `.pathTo`. Not
before: `selection.movement.some(…)` describes something the field isn't yet.)*

**Three decisions the extraction forced, all settled:**

- **How does the canvas learn the selection?** → **an `onSelectionChange`
  callback**, not returned state. The hook owns the selection (it owns
  `submitCommand`, whose whole job is optimistic set plus rollback) and must not
  know about Babylon. Returning it as state is the idiomatic option, but it costs
  two new effects, forces the click handler to be re-registered as its identity
  changes, and pulls the renderer into state to make those effects wake. The
  callback keeps the handler stable and registered once. Two riders make it a
  simplification rather than a relocation: every selection write funnels
  through one `applySelection` in the hook, and the canvas's callback reads its
  renderer ref **at call time** — which also closes a
  rollback-into-a-disposed-renderer hazard `submitCommand` carries today, since
  it captures the renderer before its await.
- **One subscription or two?** → **one, in the hook, with an `onEvents`
  callback.** The single callback sets state, clears rejection, *and* animates;
  the first two belong to the hook and the third to the canvas, so two
  listeners looks natural. Rejected because 5b sequences the commit *after* the
  animation — an ordering only expressible where one listener owns both. Two
  listeners, state in the hook and animation in the canvas, have no order
  between them at all. It also makes both hook inputs one shape rather than
  two mechanisms.

  The load-bearing line inside: the hook holds both callbacks in a
  **latest-ref**, so the subscription depends on `server` alone. `subscribe`
  fires synchronously and the listener clears the rejection — a subscription
  effect that depended on the callbacks' identities would re-run per render
  and wipe a rejection before anyone saw it. A hook test re-renders with fresh
  identities and asserts the rejection survives; it was verified to fail
  against the dependent-subscription shape.
- **`submitCommand`'s `!renderer` guard** → **accept that it disappears.** It
  existed partly to bind `renderer` for the `showSelection` calls below it, and
  the hook has no renderer. The `pendingRef` half survives; the push guards a
  null renderer itself. The honest delta: a click in the sub-frame window
  before the renderer effect runs changed from *silently refused* to
  *submitted normally* — unobservable in practice, named rather than rounded
  to zero because 5a's zero-delta claim is load-bearing.

✅ **One `MatchRoute` bug fell out of this and was fixed first.** It never
reset `server` when `matchId` changed, and react-router reuses the component for
a param change — so navigating between two matches rendered `GameCanvas` against
the *previous* match's server, which the effect cleanup had already disposed,
until the new connection resolved. Fixed by keying the connection component on
`matchId` — a param change remounts it, resetting *all* of its state (the
planned two-line reset would have missed `connection`, and the repo's own
`react-hooks` lint forbids synchronous setState in an effect body, which is
React's position too). It mattered to 5a because it was the only way `server`
could change under a mounted canvas; with the remount, it cannot by
construction, and the renderer stays a `ref`.

✅ **The client learned about 422.** The server answers a rule-rejected command
with 422 and an `ErrorResponse` body; the client used to throw on any non-2xx
that was not 404, so a refused move read *"server returned 422"* and raised the
reconnecting banner. `client/net/api.ts` gained `RejectedError` — a separate
type rather than a widening of `FailureKind`, whose two cases are exactly what
`MatchRoute` has UI for — and reads the reason off the body of every non-2xx;
`gameServer.submit` stopped treating a rejection as a transport failure.
`GameCanvas` was untouched, since `submit()` still returns a `CommandResult`.

✅ **`net/gameServer.ts` got tests, and one simplification.** It was the most
intricate untested code in the client: seq deduplication, exponential backoff,
the hidden-tab interval, and `dispose`. The dedup is load-bearing — without it a
poll in flight during a submit animates the same move twice — and nothing checked
it. `fetch` and timers are both things Vitest can fake, so the core was testable
without a DOM; the `visibilitychange` behaviour needs one, which the harness
below supplies before the extraction.

The simplification: `applyUpdate` took `EventsResponse | CommandResult` and
opened with `if ('ok' in update && !update.ok) return`, a union that existed only
to serve two callers. Moving the check to the one caller that needs it lets it
take a single shape.

```ts
poll:    applyUpdate(response)
submit:  if (result.ok) applyUpdate(result)
```

✅ **The DOM harness moved up from 5b** — `happy-dom` plus
`@testing-library/react` — because 5a's riskiest change was otherwise the one
thing 5a could not test. The extraction's failure mode is the `onEvents` wipe
described under the second decision above, and every client test had been
`handleTileClick`: the refactor could have broken the rejection UI with the gate
green, and "a 5a regression is necessarily the refactor" has teeth only if the
regression is detectable. Two dev dependencies one increment early bought
`useGameSession` landing with tests, `gameServer.ts`'s `visibilitychange`
coverage no longer waiting on 5b, and 5b starting with a harness instead of
building one while also changing behaviour. The `typeof document` guards in
`gameServer.ts` went with it — their only beneficiary was a DOM-less test run.

✅ **`strict` went on here, and it was a one-line flag flip.** It was parked for
years as its own increment on the grounds that the fallout is unpredictable.
Measured: adding `"strict": true` to `packages/server/tsconfig.json` and
`packages/client/tsconfig.app.json` produces **zero errors** across every
package. Verified the measurement rather than trusting it — a deliberate
`string | null` assignment in client code is caught, so `strict` genuinely
reaches the source being checked — and re-measured with `tsc -b --force` on the
day it landed.

So there was no fallout to absorb, and turning it on cannot change behaviour —
this step is as shape-only as the refactor around it.

⚠️ 5a does carry one behaviour-changing step, but it is not this one: teaching
the client to read the server's 422 alters the error text a user sees. It lands
as its own commit, after the `gameServer` tests exist to cover it. Everything
else in 5a is shape-only, which is what "a 5a regression is necessarily the
refactor" depends on.

It went **first**, but for a different reason than absorbing risk: 5a
writes new code — the `SelectionState` union, `useGameSession`, the `gameServer`
tests — and writing that under `strict` from the start is cheaper than
retrofitting it. The union is the clearest case: `{ selectedUnitId: string |
null }` becoming a discriminated union is the same nullability work
`strictNullChecks` would force anyway.

*(`packages/client/tsconfig.node.json` covers only `vite.config.ts` and was not
included in the measurement; 5c deletes it.)*

**Verifiable now.** The earlier warning here — *"nothing verifies this beyond
playing the game"* — is retired. `handleTileClick` has 11 Vitest tests, of which
**4 assertions across 3 tests** touch the record shape; the rest assert
`initialSelectionState` or the emitted command and survive the conversion
untouched. Playing it in a browser is still the check for the renderer half.

#### 5b — animation gates the state commit. A behaviour change.

The one problem this phase solves is the ordering bug latent since phase 3:
**state commits before animation finishes.** The listener sets the replica to
the final state and *then* starts the tween. Harmless today for exactly one
reason — Babylon owns the unit meshes and nothing reconciles them against
state — and fatal in 7c, where `syncUnits(state)` would snap a mid-tween unit
to its destination, or delete a dying unit's mesh before the hit lands.

That is an *ordering* problem, not a state-derivation problem, and the fix is
one constraint, not a new state model: **a state is committed only after the
events that produced it have finished animating.**

##### The pipeline

`useGameSession`'s listener becomes a short serial pipeline:

```
on update (events, state):
  clear the rejection                 -- on arrival: newer authority supersedes it
  enqueue:
    if worthAnimating(events):  await onEvents(events)   -- the canvas's playEvents
    onSnap(state)                                        -- idempotent correction
    commit state                                         -- setGameState, always last
```

- **The queue is a promise chain inside the hook.** Batches run in arrival
  order; a batch cannot start until the previous one committed. It exists
  because a poll can deliver batch two while batch one is still animating.
  `GameServer` and `UpdateListener` do not change — backpressure from animation
  is a UI concern and never belongs in the transport.
- **`onEvents` becomes awaitable** — `(events: GameEvent[]) => Promise<void>`.
  The canvas already holds the promise (`playEvents` returns it; today it is
  discarded). Events stay an array; there is no per-event callback.
- **`onSnap(state)` always runs, inside the queue, before the commit.** Today
  it is `renderer.snapUnits(state)` — position the existing meshes from state,
  no tween, ~10 lines — and 7c grows it into `syncUnits` (add/remove). After an
  animated batch it is a visual no-op; after a skipped or *failed* animation it
  is the correction. This is "the snapshot is self-healing" made concrete, and
  because it runs inside the queue it can never race another batch's animation
  — which an effect driven by the committed state could, so it deliberately is
  not one.
- **A failed animation is caught, snapped over, and committed.** The queue must
  never wedge on a rendering error.
- `submitCommand` gets a `try`/`finally` on its in-flight flag while this file
  is open — the hook is written against the `GameServer` *interface*, and an
  implementation that rejects would otherwise soft-lock the UI forever.

##### `worthAnimating` — snap, don't replay

**Animate small live batches; snap everything else.** Two conditions, either
one skips straight to `onSnap` + commit:

- **The batch is large** (more than ~10 events — the constant just has to
  separate "a dropped poll" from "gone a while"). Catch-up replay is for a
  spotty connection missing one poll, not for returning after lunch: these are
  chess-length games, and replaying an absence at tween speed is worse than
  useless.
- **The tab is hidden.** Browsers throttle rAF in hidden tabs, so an awaited
  animation would stall the queue — snap-on-hidden is wedge-prevention, not
  just taste. (The `visibilitychange` handler already polls immediately on
  return, so the return path animates normally.)

##### Why the client does not fold

An earlier version of this phase had `useGameSession` folding each event with
`applyEvents`, mirroring the server's model. Dropped, for the same kind of
reason push was dropped: enumerate the consumers and nobody needs it.

- **The renderer animates from event payloads, not from state.** That is the
  granularity principle events were designed around — `unitMoved` carries the
  path, `unitAttacked` will carry resulting HP, `unitDied` carries the id.
  `playEvents` never reads `GameState` at all.
- **The only React consumer of the replica is the turn label.** Per-event
  folding buys the label flipping mid-batch instead of at batch end —
  imperceptible at one-to-three events, and arguably worse (today it flips
  before the unit finishes walking).
- **Replay stays buildable without being wired in.** `applyEvents` remains
  exported from `shared/`; a replay or debug tool can fold the log any time.
  Late-join needs no replay — `GET /state` is one request.

The escape hatch is recorded at 7d, where it could first be needed: if a
combat animation ever needs the state *between* events of one batch (damage
numbers are `before − after`, and a catch-up batch can hit the same unit
twice), the answer is a **local** fold threaded through the animation walk —
`applyEvents` as a plain helper inside the queue task, never a per-event React
commit, never a signature change.

##### What stays true

- **The replica lags deliberately during animation.** `getState()` is already
  authoritative and ahead (invariant 1); `clickTile` reads it and does not
  change. The lag is the point — the *displayed* world stays consistent with
  what has been shown.
- The client still keeps no checkpoint and runs none of the server's
  event-sourcing machinery — it is now further from it, not closer.
- Folding was never resolution, and neither is snapping — invariant 8 is
  untouched: *deterministic preview yes, random resolution no*.

##### Order and verification

Two commits: the `try`/`finally` fix (independent, lands first), then
`snapUnits` + the pipeline + its tests together. The harness is already in
place from 5a; the tests drive a deferred animate callback and assert the
commit is gated on it, batches serialize, the threshold and hidden cases skip
to snap-and-commit, and a rejecting animation still commits. The browser check
(`/run-app`) is the visual half: a move should animate before the turn label
flips.

#### 5c — the client moves onto bun's bundler ⬜

Vite and Vitest come out; `bun build` and `bun test` go in. Sequenced last
because nothing depends on it — and because doing it earlier would mean writing
the repo's trickiest tests while changing the runner underneath them.

What it deletes:

- **`serveClient` in `http.ts`** — an HTML import becomes a route value and bun
  serves the hashed assets itself. Fifteen lines of production-only code that
  never runs during development.
- **The Vite proxy**, and with it the two-process dev setup. One `bun --hot`
  serves the API and the client together.
- **One of two test runners**, so the root `test` script stops being two
  commands.

What it changes:

- `import.meta.env` is not supported — bun replaces literal `process.env.FOO`
  only, via `define`. Two call sites, both gating the Inspector: `renderer.ts`
  and `GameCanvas.tsx`.
- **The Inspector guarantee has to be re-earned, not assumed.** It is documented
  to survive — *"if the only reference to a module exists within unreachable
  code, the chunk isn't generated"* — but the ✅ under Dev tooling was earned by
  checking `dist/`, and it should be re-earned the same way.

Verified up front rather than assumed, because each was a candidate blocker:

- `jest.advanceTimersByTime` exists in `bun test` and drives a self-rescheduling
  async poll loop with exponential backoff — `gameServer.ts`'s exact shape —
  with no real waiting. Only the *async* variants are missing, which costs a
  three-line helper flushing microtasks between firings.
- React component tests work: `@happy-dom/global-registrator` preloaded through
  `bunfig.toml`, plus `@testing-library/react`.
- The existing client tests port by changing one import line — which
  Verification already records as true of this repo's suites.

**The workspaces collapse here too.** `packages/{shared,server,client}` become
`src/{shared,server,client}` under a single `package.json`, and `@vod/*` imports
become relative. It belongs in 5c rather than standing alone because 5c already
removes Vite and Vitest — the main tooling reason the client held its own
manifest — so doing them together is one restructure instead of two.

**This trades a resolution-enforced boundary for a lint-enforced one, knowingly.** Today `packages/server/node_modules/` contains no React and no Babylon, so a stray import is `TS2307` rather than something caught in review — verified by trying it. One `node_modules` ends that, and the barrel rule (`@vod/shared`'s `exports` map, and `./testing` as a deliberate second surface) goes with it.

The replacement is the core `no-restricted-imports` rule scoped by flat config, which needs no new dependency. Verified against fixtures — server importing React, Babylon, or client code all fail; `shared` importing anything bare fails while relative imports inside it pass:

```js
{ files: ['src/server/**/*.ts', 'src/client/**/*.ts'],
  rules: { 'no-restricted-imports': ['error', { patterns: [
    { group: ['react', 'react-dom', '@babylonjs/*'] },
    { group: ['**/client/**'] } ] }] } },
// shared is pure: anything not starting with "." is external
{ files: ['src/shared/**/*.ts'],
  rules: { 'no-restricted-imports': ['error', {
    patterns: [{ regex: '^[^.]' }] }] } },
```

Note this is *stronger* than today in one respect: the direction rules — `shared/` importing only from `shared/data/`, and `server`/`client` not importing each other — are currently convention checked by review, and become enforced. Structure and Dependency rule above get rewritten when this lands.

⬜ **The one open unknown**: whether bun's bundler produces a comparable Babylon
build. Today's is 6.9 MB across 73 chunks and rolldown already warns about chunk
size. Spike that before starting; everything else is settled.

### 6 — Terrain and movement

Terrain and pathfinding are one system: the Dijkstra **is** the pathing, `validatePath` is meaningless without a cost table, and route preview is the same search reading its predecessors. Full spec in Terrain.

- Terrain types incl. `bridge`; one table carrying cost-per-movement-type and a single defence value
- `exploreMovement` — Dijkstra returning the reachable set and `pathTo(destination)`
- `validatePath` inside `validateMove` — closes the existing unvalidated-`path` hole. It lands there rather than anywhere else because validation and resolution are already separate: `validateMove` decides legality, `resolveMove` only emits the event
- Character-grid maps in `server/maps/`; `createInitialState()` becomes `createMatchState(map)`, and `matches` gains `map_id`. **That column is the first real schema migration** — the thing the migration tooling exists for, and worth doing deliberately rather than as an afterthought
- Terrain rendering, and a route highlight on the chosen destination
- Confirmation step: pick destination → see route → confirm, rather than committing on click

Terrain leads because **terrain defence is not a minor modifier** — four stars at full health halves incoming damage. Tuning a matchup table with it stubbed to zero produces numbers to throw away.

Verifiable with no combat: does the overlay stop at mountains, does cavalry outrange artillery on roads, does the server reject a path through impassable terrain.

### 7 — Combat: the smallest thing you can win

Terrain and pathing already exist by this point, so the numbers mean something. The integration risk here is the chain — command → resolve → events → animate → death → mesh removal → victory — not the damage formula.

- **7a** `UnitType` catalog — migrate `Unit.movementRange` onto it. *(`unitTypes.ts` has existed unreferenced since early on.)*
- **7b** `Unit` gains `health`/`maxHealth` and `unitTypeId`; update the starting units. **No migration** — `Unit` lives inside `GameState`, which is a JSON blob, so the shape changes without the schema moving. That is the JSON-blob decision paying off, and it is why `map_id` in phase 6 is the first migration rather than this.
- **7c** `GameRenderer.syncUnits(state)` — mesh add/remove, required before anything can die. It grows out of 5b's `snapUnits` and runs where that runs: inside the hook's queue, after the batch's animation, before the commit. Assumes 5b landed — without the gated commit, reconciling meshes against a state whose events are still animating is exactly the ordering bug 5b retired.
- **7d** `UnitActionCommand` replaces `MoveCommand` — path plus optional attack, atomic. Simplest resolution: adjacent only, damage from a table, no counter-attack, no charge. Damage and death events. Touches three places, all separate now: `parseCommand` for the wire shape, `validateMove`'s successor for legality, and `resolveMove`'s for the events — plus rolls, which arrive as an argument to resolution so `shared/` stays pure.

  ⚠️ **Invariant 9 constrains the events.** `unitAttacked` must carry the target's *resulting* HP, not the damage dealt — a delta applied twice deals it twice. Damage is `before − after`, which the client can compute from the state preceding the event. And a successful charge emits `unitDied` **plus** `unitMoved`, two independently-applicable events, not one compound event carrying both effects.

  ⚠️ One nuance the client will hit here, parked by 5b with its answer attached: in a multi-resolution catch-up batch, "the state preceding event *k*" is the pre-batch replica folded through events 1..k−1 — a second hit on the same unit computes its damage number from the intermediate HP, not the pre-batch one. If the animation needs that, thread a **locally** folded state through the animation walk (`applyEvents` as a plain helper inside the queue task) — never per-event React commits, never a callback-signature change. Large batches snap without animating anyway (5b's threshold), so this only matters for small ones.
- **7e** Attack in `handleTileClick` — clicking an enemy while selected becomes a real action, plus an attack-range overlay.
- **7f** Victory conditions. Elimination first: a player with no units loses. `GameState` gains a terminal marker so "finished" is a fact rather than re-derived, `validateCommand` refuses everything once set, and a `gameEnded` event tells clients to stop.

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

Schema work: `owner_id` on `matches`, a lobby `status` column, and a `sessions` table — three migrations, generated from `schema.ts`. Also **removes a read**: `http.ts` currently loads the match twice per command because `resolveActor` needs state to stamp `actor = currentTurn` while `submit` owns the read. A session lookup needs no state, so the extra read goes with it.

`resolveActor` is the only server change: it stops returning `state.currentTurn` and looks up the session. Client-side, the one function that answers "who is the user" reads it from the session instead of deriving it, and gains an ownership check so a browser doesn't offer units it can't command.

Until all three land, two tabs share control of both players rather than being two players.

#### Security work that only becomes possible here

**Today there is no authorization, not weak authorization.** `resolveActor` ignores the session and returns `state.currentTurn`, so the cookie gates nothing: any client, with or without one, can submit as whichever player's turn it is, to any match id — and `GET /api/matches` hands out the ids. That's the deliberate hot-seat concession, but it's worth stating in those terms, because several defences are pointless until it changes:

- **CSRF hardening is premature.** `SameSite=Lax` already blocks a cross-site POST from carrying the cookie, and an attacker doesn't need the cookie anyway — there is no authority to forge. Tokens and double-submit patterns become meaningful the same day `resolveActor` starts trusting the session, and not before.
- **`GET /api/matches` becomes an information leak.** It currently lists every match from every visitor. Harmless while matches are unowned; the moment they're owned, listing must be scoped to the player — which is the same change already recorded under Known compromises, arriving for a second reason.
- **`404` on a missing match stops being neutral.** Once matches are owned, "no such match" and "not yours" should be the same response, or the endpoint becomes an existence oracle.

⚠️ **5c widens this.** The race below is survivable today partly by accident: in dev, Vite serves `index.html`, so the browser's first contact with *our* server is already an API call, and in production the HTML response sets the cookie before any API call can race. Once 5c makes one process serve both, that accidental ordering is the only thing between us and concurrent cookie-less requests on a cold load — so it stops being a production-only concern.

**Two constraints on the sessions table, from how the cookie behaves today.** `withSession` mints an id for any request arriving without one, so concurrent requests from a browser with no cookie yet each mint a *different* id and each set it — last write wins. That is not a defect: nothing reads the id (`resolveActor` ignores it) and nothing persists it, so there is no state to corrupt. It becomes one the moment a session store assumes otherwise, which is why the requirements are recorded here rather than worked around in the wrapper:

- **Create session rows at sign-in, not on arrival.** The orphan problem is a *rows* problem. If a row only exists once someone authenticates, the ids a browser mints and discards never become rows, and the race stops mattering without needing to be prevented — which is the only approach that works, since two cookie-less requests are indistinguishable and cannot be serialised.
- **Rotate the id on sign-in.** An id minted for an anonymous visitor must not survive into an authenticated one, or an attacker who plants a known cookie inherits the session after the victim logs in. Standard session-fixation defence, and it makes every pre-auth id irrelevant by construction.

Both are defaults in Better Auth, which is a further point in its favour above.

**Where the check goes.** Whatever provides identity resolves to a `PlayerId` in one place, before `actor` is stamped — see Identity. Ownership is then a lookup in front of the authority, never a rule the reducers know about. Note that `canSelectUnit` deliberately stays a game fact and needs no identity: the server already rejects a command for a unit the actor doesn't own, because `actor === currentTurn` and `unit.owner === currentTurn` compose.

## Verification

`bun run lint`, `bun run test` and `bun run build` after any change — all must stay clean, and all exit non-zero on failure (verified, not assumed).

⚠️ Check the **exit code**, not the output. `bun run typecheck | tail -3 && echo OK` chains the `&&` to `tail`, which always succeeds, so it prints OK on failure. That happened.

`build` is `tsc -b && bun run --filter '@vod/client' bundle`: one typecheck pass across every package, then bundle. `bun run typecheck` is the `tsc -b` half alone.

`noUnusedLocals` / `noUnusedParameters` are on, `strict` is on (5a's first commit), and `verbatimModuleSyntax` requires explicit `import type`.

**Tests: `bun test` for `shared/` and `server/`, Vitest for `client/`.** Two runners because `bun test` needs no dependency or config and covers the pure packages, while Vitest reuses the client's `vite.config.ts` and is the only route to React component and hook tests. Test files are portable between them — the same suite ran under both, differing only in the import line. The root `test` script runs both. Server tests use `:memory:`, one database per test, migrated in `beforeEach`.

**`http.test.ts` is a black box over real requests**, not a call into a handler: it calls `createServer({ port: 0, databaseUrl: ':memory:' })`, reads `server.url`, and drives it with `fetch`. Nothing in it knows how a URL is dispatched, which is why swapping hand-rolled parsing for `routes` did not touch a line of it — the property worth keeping the next time routing changes.

Both inputs are **arguments rather than environment**, which is what makes the setup three lines and a plain static import. Port 0 lets the OS pick, so a running dev server cannot collide with the suite; `:memory:` keeps the real database out of reach. `http.ts` starts a server only under `import.meta.main`, so importing it for the factory listens on nothing — verified in both directions, since a module that opened a port on import would have made all of this ordering-dependent.

**Typechecking reads `shared`'s source directly. No declaration output, no project references across packages.** `server` and `client` resolve `@vod/shared` through its `exports` field to `src/index.ts` and pull that source into their own programs, so `shared` is checked as a byproduct of being imported and needs no pass of its own. The root `tsconfig.json` is a solution file over `server` and `client` only.

This replaced a project-references setup, and the reasoning is worth keeping because the arguments for references sound better than they measure:

- **Ordering was circular.** References are what made `server` unable to typecheck before `shared` had emitted; `tsc -b` then solved a constraint nothing else imposed. Without them there is no artifact to wait for and no order to get wrong — and the whole `TS6305` failure class goes with it.
- **Incremental caching didn't apply.** Only the referenced project was ever skipped; `server` and `client` are `noEmit`, so they have no output to prove currency and re-check every run regardless. Three consecutive no-op runs measured 2.80s / 2.74s / 2.62s — flat.
- **The one real cost of removing them**: an error inside `shared` is now reported twice, once per consuming program. Verified. Accepted as cheap at two consumers; it's the thing to re-examine if a third appears or `shared` grows a lot.
- Stale artifacts were a live hazard rather than a theoretical one. Deleting `dist-types/` left `.tsbuildinfo` still claiming everything was current, and `tsc -b` declined to regenerate — recovery meant deleting every `.tsbuildinfo` by hand.

`client` keeps its own `tsconfig.app.json` / `tsconfig.node.json` split, which is unrelated: `vite.config.ts` needs Node types and `nodenext`, `src/` needs DOM and `bundler`. Two genuinely different programs.

None of this ever was a runtime build step: package `exports` point at `src/*.ts`, and both Vite and bun load the TypeScript directly.

For anything visual, run the dev server and check in a browser. Hot reload usually suffices, but hard-reload if something that worked stops — Babylon's engine/scene lifecycle doesn't always survive HMR cleanly.
