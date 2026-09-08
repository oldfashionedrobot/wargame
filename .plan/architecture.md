# Victory or Death — Architecture

Turn-based strategy game, American Revolutionary War theme. React + TypeScript
+ Babylon.js, built with bun.

**This document describes the code as it is.** No rationale, no history. What
is planned but unbuilt lives in [`roadmap.md`](roadmap.md).

**What plays today:** hot-seat against a real server process. Select a unit,
see the tiles it can reach across terrain, hover to preview the route, click to
move it there, end turn. Two players, one infantry, cavalry and artillery each,
on an 8×8 map split by a river with a single bridge. No combat.

## Packages

Three bun workspaces, split by authority. Installs are isolated rather than
hoisted, so a package can only import what it declares.

| Package | Depends on | Holds |
|---|---|---|
| `@vod/shared` | nothing | The rulebook: types, content tables, queries, movement, validation, resolution, the event fold, and the wire protocol. No I/O, no RNG, no React, no Babylon, no `Date.now()`. |
| `@vod/server` | `shared` | The authority: the database, the event log, match construction, and the HTTP surface. |
| `@vod/client` | `shared` | Presentation: Babylon rendering, input, React, and the HTTP `GameServer`. |

`shared` has two entry points, no build script, and emits nothing — `exports`
point at TypeScript source, which bun runs natively and Vite compiles:

- `.` → `src/index.ts`, the rulebook barrel. Holds only what `server` and
  `client` consume.
- `./testing` → `src/testing.ts`, fixtures, imported by tests only.

`server` has no barrel and no `exports`; `src/http.ts` is an entry point that
gets run. Nothing imports `server`.

```
packages/
  shared/src/
    types.ts          Coordinate · Facing · Player · Unit · GameState · Command · GameEvent
    coordinate.ts     coordinatesEqual · coordinateKey · isWithinGrid
    queries.ts        getUnit · getUnitAt · getTileAt · getCurrentPlayer
    legality.ts       canSelectUnit
    movement.ts       exploreMovement · validatePath · entryCost (private)
    terrainGrid.ts    parseTerrainGrid
    action.ts         validateCommand · resolveAction · the Action brand
    move.ts           validateMove · resolveMove
    endTurn.ts        validateEndTurn · resolveEndTurn
    applyEvents.ts    applyEvents
    protocol.ts       GameServer · CommandResult · wire shapes · parseCommand
    testing.ts        makeState · route · unitAt
    index.ts          the barrel
    data/
      unitTypes.ts    UNIT_TYPES · getUnitType
      terrain.ts      TileType · TERRAIN · getTerrain
  server/
    src/
      http.ts         createServer() — Bun.serve routes, /api/* plus the client build
      match.ts        MatchStore: create · list · snapshot · since · submit
      db.ts           libSQL client + Drizzle, pragmas, migrations at boot
      schema.ts       matches · resolutions, typed from shared
      matchState.ts   createMatchState(map) — instantiates a map into a board
      maps/           classic.ts · index.ts (registry) · types.ts (GameMap)
      const.ts        env-derived defaults
    drizzle.config.ts drizzle-kit config; imports DEFAULT_DB_URL from const.ts
    drizzle/          generated migrations, committed
    schema.sql        the whole current shape in one file
  client/
    index.html  vite.config.ts  public/  scripts/compressDist.ts
    src/
      main.tsx · App.tsx · index.css · test-setup.ts
      routes/     StartScreen.tsx · MatchRoute.tsx
      net/        api.ts · gameServer.ts
      game/       useGameSession.ts · GameCanvas.tsx
        interaction/  selection.ts
        render/       renderer.ts · terrain.ts · units.ts · highlight.ts
                      tileOverlay.ts · gridLines.ts · picking.ts · coordinates.ts
```

## Commands

Run from the repo root. All exit non-zero on failure.

| | |
|---|---|
| `bun run dev` | Vite (5173) + server (3001); `/api` is proxied, same-origin everywhere |
| `bun run test` | `bun test` for shared + server, then Vitest for client |
| `bun run typecheck` | `tsc -b` — use `bunx tsc -b --force` for a real check, since `.tsbuildinfo` can report stale |
| `bun run lint` | ESLint across the repo |
| `bun run build` | `tsc -b`, then bundle and compress the client |
| `bun run format` / `format:check` | Prettier (Markdown is excluded) |
| `bun run db:generate` / `db:migrate` | drizzle-kit — **from the repo root only** |
| `bun run preview` | `vite preview` — the built client with no `/api` proxy, so it reaches no match |
| `bun run --filter '@vod/server' start` | The production shape: one process serving the API and `dist` together |

Single test file: `bun test packages/server/src/match.test.ts` (`-t 'name'` to
filter); client: `cd packages/client && bunx vitest run src/net/gameServer.test.ts`.

`db:*` must run from the root: `file:` URLs in `DATABASE_URL` resolve against
the repo root, and running them through `bun run --filter` sets the cwd to the
package and loses the single root `.env`.

## The pipeline

```ts
validateCommand(state, command, actor) → { ok: true, action } | { ok: false, reason }
resolveAction(state, action)           → GameEvent[]
applyEvents(state, events)             → GameState
```

| | Direction | Contents |
|---|---|---|
| `Command` | client → server | Intent only. No actor, no dice. Can be rejected. |
| `Action` | inside the server | An accepted `Command`, plus `actor`. Carries a `unique symbol` brand that is never exported, so it can only come from `validateCommand`. |
| `GameEvent` | server → clients | A fact that already happened. What clients animate. |

`validateCommand` checks `actor === state.currentTurn` first, then dispatches to
the per-command validator. `resolveAction` accepts nothing but an `Action`.

## Rules that hold

1. **The database is the only mutable state.** No module-level mutable state
   exists in `server/`; every request reads, computes, and writes back.
2. **`shared/` is pure** — no I/O, no RNG, no Babylon, no React, no `Date.now()`.
3. **`GameServer.submit()` is async.**
4. **`GameState` is JSON-serializable** — no `Map`, `Set`, class instance,
   `Date`, or function is reachable from it.
5. **An unvalidated action is unrepresentable** — `validateCommand` is the only
   constructor of an `Action`.
6. **Single source of truth.** A unit's position lives only in `unit.position`;
   occupancy and selection are derived by query.
7. **Ephemeral UI state stays out of `GameState`** — hover, selection, camera,
   animation progress.
8. **The client never resolves outcomes.** It may read any deterministic part of
   `shared/` to preview (what is selectable, where a unit can move); the server
   re-checks all of it.
9. **`applyEvents` is the only thing that mutates state.** Every event is
   **independently applicable** to the state before it and carries **absolute
   values, not deltas**, so applying one twice is a no-op. Idempotence is tested
   per event type; independent applicability by replaying log prefixes.
10. **The client and server share one movement cost model** — `entryCost` in
    `movement.ts` is the single function both the search and the path check
    call.

## State model

```ts
Coordinate  { col, row }
TileType    'plains' | 'road' | 'bridge' | 'forest' | 'mountain' | 'river'
Facing      'north' | 'east' | 'south' | 'west'      // decorative; nothing updates it
PlayerId    string                                   // never a union of colours
PlayerColor 'blue' | 'red' | 'green' | 'yellow'      // the renderer keys on it
Player      { id, name, color }                      // colour is display-only
Unit        { id, position, facing, unitTypeId, owner, hasActed }
GameState   { grid, units, players, currentTurn }    // grid is [row][col]

Command       MoveCommand { type, unitId, path } | EndTurnCommand { type }
Action        (MoveCommand & Validated) | (EndTurnCommand & Validated)
              -- a union of intersections, not Command & { actor }: the
              latter would admit an endTurn carrying a path
GameEvent     UnitMovedEvent { type, unitId, path } | TurnEndedEvent { type, nextPlayer }

ValidationResult  { ok: true, action } | { ok: false, reason }
CommandResult     { ok: true, seq, events, state } | { ok: false, reason }
StateResponse     { seq, state }
EventsResponse    { seq, events, state? }
MatchSummary      { id, createdAt, seq, currentTurn }
ErrorResponse     { error }                          // the body of every non-2xx
```

Turn order is array rotation over `GameState.players`, wrapping via modulo.
`hasActed` is one flag per unit, set by `unitMoved` and reset by `turnEnded` for
the incoming player only.

## Content — `shared/src/data/`

Static tables keyed by `Record`, so adding a member makes every incomplete table
a compile error.

**`unitTypes.ts`** — `{ id, name, movementType, movementRange }`:

| Unit | Movement type | Range |
|---|---|---|
| Infantry | `foot` | 3 |
| Cavalry | `horse` | 6 |
| Artillery | `wheels` | 4 |

**`terrain.ts`** — `{ char, defense, cost }` per terrain. `char` is the map
symbol; `defense` is stars of cover and is not read by anything yet; `cost` is
movement points to *enter*, and `null` is impassable.

| Terrain | char | defense | foot | horse | wheels |
|---|---|---|---|---|---|
| road | `-` | 0 | 1 | 1 | 1 |
| bridge | `=` | 0 | 1 | 1 | 1 |
| plains | `.` | 1 | 1 | 1 | 2 |
| forest | `f` | 2 | 1 | 2 | 3 |
| mountain | `^` | 4 | 2 | — | — |
| river | `~` | 0 | 2 | — | — |

`getUnitType` and `getTerrain` throw on an unknown id.

## Maps

Every grid comes from parsing a character map; there is no other construction
path. `parseTerrainGrid(rows: string[]): TileType[][]` inverts the terrain
table's `char` column and throws on an unknown character or a ragged row.

Maps are modules in `server/src/maps/`, registered by id:

```ts
interface GameMap {
  id: string;
  name: string;
  rows: string[];                                       // parsed by parseTerrainGrid
  units: { at: Coordinate; type: UnitTypeId; owner: number }[];
}
```

`owner` is an **index into the match's players**, not a `PlayerId` — a map
cannot know who is playing it. `createMatchState(map)` resolves the index
against the two hardcoded players and generates unit ids as `${colour}-${n}`,
numbered per owner in the order the map lists them. The ids are deterministic
because `initial_state` plus the log must replay identically.

⚠️ **Map ids are immutable.** A match records the id it was built from, so
changing a map's terrain under its id retroactively changes what every existing
match claims to have been played on. A changed map gets a new id.

`getMap` throws on an unknown id. One map exists: `classic` — a river split by
a single bridge, with mountains flanking the far approach and forest the near
one, so infantry can ford where cavalry and artillery must take the bridge.

The test fixture `makeState` accepts either map rows or a size, and a size
generates a plains character map and parses that.

## Movement

```ts
exploreMovement(state, unit, movementRange, movementType) → Movement
  .reachable                   // Coordinate[] — where the unit may stop
  .pathTo(destination)         // Coordinate[] | null — cheapest route
```

The budget and movement type are arguments; callers resolve them from
`getUnitType`. The search relaxes over a FIFO queue: a neighbour already
recorded more expensively is lowered and re-queued.

`reachable` and *settled* are different sets. A friendly unit's tile is settled
and walkable-through but is not a destination, so `pathTo` answers for a larger
set than `reachable` lists. The unit's own tile stays in the map — every path
chain terminates there — and `pathTo(unit.position)` is `[position]`.

An enemy blocks the tile *and* the route; a friend blocks only the tile.

```ts
validatePath(state, unit, path, movementRange, movementType) → string | null
```

Walks a client-supplied route: starts at the unit, every step orthogonally
adjacent, no tile twice, nothing impassable or enemy-held, total within budget,
and a destination unoccupied by anyone but the moving unit. A single-element
path is legal and costs 0. The server never derives a route.

Both the search and the walk call `entryCost(state, unit, coordinate,
movementType)`, which returns `{ ok: true, cost }` or `{ ok: false, reason }` —
the one place that decides whether a tile can be entered and what it costs.

## HTTP

Plain request/response over `Bun.serve`'s own `routes` table. No SSE, no
WebSockets, no server push. Everything is same-origin in dev and production
alike; the client calls `/api/*` relative.

```
GET  /api/matches                     → MatchSummary[]           (newest 50)
POST /api/matches                     → MatchSummary             201
GET  /api/matches/:id/state           → { seq, state }
GET  /api/matches/:id/events?since=N  → { seq, events, state? }
POST /api/matches/:id/commands        → { ok: true, seq, events, state }   200
                                      | { error }                         422
'/api/*'  → 404, including a method an endpoint does not serve
'/*'      → the client build
```

Status carries the outcome: a missing match is **404**, a malformed body, a body that was never a
command, and a bad `since` query parameter are all **400**, a well-formed command the rules refused is **422** with the
reason in the body. Every non-2xx body this code writes is an `ErrorResponse`;
the one exception is bun's own 413 from `maxRequestBodySize`, which it answers
before a handler runs.

`state` is present on an events response only when `seq` advanced past the
requested `since`. A caught-up poll answers `{ seq, events: [] }` and skips the
log query.

**Payload limits:** `maxRequestBodySize` is 64 KB; `MAX_PATH_STEPS` in
`parseCommand` is 256. `parseCommand` validates shape and field types at
runtime and rebuilds a fresh object, so extra properties are dropped.

**Session:** `withSession` wraps every route entry and mints an opaque id into a
`vod_session` cookie — `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` one
year, and `Secure` in production. Nothing reads it: `resolveActor` returns `state.currentTurn`, so any
client can act as whoever's turn it is.

**Serving the client build:** `'/*'` serves `packages/client/dist`, falling back
to `index.html` so deep links survive a refresh. `clientDist` is a
`createServer` option. Requests resolve against the dist directory and are
confirmed to stay inside it. When `Accept-Encoding` allows, the `.br` then `.gz`
sibling is served with `Content-Encoding` and the *original* file's
`Content-Type`. `Vary: Accept-Encoding` rides every response, compressed or
not. `/assets/*` gets `Cache-Control: public, max-age=31536000, immutable`;
everything else `no-cache`.

## Data store

SQLite via the libSQL client and Drizzle. `DATABASE_URL` is the only difference
between a local file and hosted Turso.

```sql
matches      (id, created_at, initial_state JSON, current_state JSON,
              current_seq, current_turn, map_id, PRIMARY KEY (id))
resolutions  (match_id, seq, actor, action JSON, events JSON, created_at,
              PRIMARY KEY (match_id, seq),
              FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE)
```

`initial_state` is written and never read. `current_state` is a checkpoint;
events are authoritative. `current_turn` is denormalised so listing matches
parses no boards. `action` and `map_id` are written and never read.

**Paths:** a relative `file:` URL in `DATABASE_URL` resolves against the repo
root, not the cwd. `DEFAULT_DB_URL` lives in `src/const.ts`, and
`drizzle.config.ts` imports the same constant.

**Migrations** are generated by `db:generate` from `schema.ts`, committed, and
applied by `migrate()` at boot. `schema.sql` is refreshed by the same script.

**Pragmas:** `journal_mode = WAL` is set in `migrate()` (a property of the
file); `busy_timeout` is set in `createDb` (per connection). Both are skipped for a
non-`file:` URL.

**Writes:** `submit` reads state and seq, validates, resolves and folds — all
pure — then runs one `batch` in `'write'` mode containing the log insert and the
match update. The update carries `AND current_seq = ?` and throws if it matched
nothing. Two writers claiming the same seq violate `PRIMARY KEY (match_id, seq)`.
Statements are built by Drizzle and executed by the raw driver, because Drizzle's
own `batch()` cannot pass a transaction mode.

## Client

**`net/api.ts`** — the `/api` base, JSON, and the one place a response becomes
`notFound`, `unreachable`, or a rejection. `HttpError` carries a `FailureKind`;
`RejectedError` is a separate type for a 422. Also holds `api.matches.list()`
and `.create()`.

**`net/gameServer.ts`** — `connectGameServer(matchId, { onConnectionChange? })`
returns `{ ok: true, server } | { ok: false, kind, reason }`.
`onConnectionChange` reports a `ConnectionStatus` of `'connected' | 'retrying'`,
which surfaces as a reconnecting banner. It fetches initial state
before returning, so `getState()` is synchronous. Polling every 2s, doubling to
30s on failure and resetting on success; a hidden tab polls at the slowest
interval and a `visibilitychange` listener resets and polls immediately on
return. Updates are deduplicated by `seq` before reaching any listener.
`dispose()` stops the loop, clears listeners, and removes the listener.

**`routes/`** — `/` is `StartScreen` (list and create); `/:matchId` is
`MatchRoute`, which is keyed on the id so a param change remounts the
connection. It owns the async connect, renders `GameCanvas` only once a server
is ready, and disposes on unmount including a connection that resolves after
teardown. A failure renders one of two things, which is what `FailureKind` is
for: `notFound` offers a link back and no retry, `unreachable` offers a working
Retry that re-runs the connect.

**`game/useGameSession.ts`** — the session: render replica, rejection state,
in-flight guard, selection, and submits. Takes `onSelectionChange`, `onEvents`
and `onSnap` callbacks held in a latest-ref, so the subscription depends on
`server` alone.

Every update runs through a serial promise queue:

```
on update (events, state):
  clear the rejection                       -- immediately, on arrival
  enqueue:
    if worthAnimating(events): await onEvents(events)
    onSnap(state)
    commit state
```

`worthAnimating` is false for an empty batch, for more than 10 events, and while
the tab is hidden. A failing animation or snap is caught and logged; the commit
always happens.

**`game/interaction/selection.ts`** — `handleTileClick(state, selection,
coordinate)` returns a new selection and an optional command. Pure: no React, no
server. `SelectionState` is a discriminated union:

```ts
| { phase: 'idle' }
| { phase: 'unitSelected'; unitId; position; movement }
```

`movement` is the whole `exploreMovement` result, snapshotted at selection time.
`reachable` decides whether a click is a move; `pathTo` builds the path the
command carries.

**`game/GameCanvas.tsx`** — the canvas ref, the renderer lifecycle, and the
chrome around it: the turn label, End Turn, the rejection reason, the
reconnecting banner, and a Toggle Inspector button under an
`import.meta.env.DEV` guard. Its three callbacks read the renderer ref at call
time.

## Rendering

`createGameRenderer(canvas, initialState)` returns:

```ts
onTileClick(handler)      setSelectedTile(coordinate | null)
setMovement(movement)     playEvents(events): Promise<void>
snapUnits(state)          toggleInspector()          dispose()
```

- **Camera:** `ArcRotateCamera` in `ORTHOGRAPHIC_CAMERA` mode, starting at a
  fixed isometric angle. Orbit and wheel zoom stay attached and both work. The
  ortho bounds are recomputed from the grid size on construction and on window
  resize; the `resize` listener is removed in `dispose()`.
- **Tile lookup is math, not mesh-picking** — `screenToTile` intersects a camera
  ray with the `y = 0` plane, so terrain must stay flat.
- Terrain is one merged mesh, vertex-coloured per tile from a
  `Record<TileType, Color4>`. Grid lines are a `LineSystem`. Two
  `createTileOverlay` meshes draw the reachable range and the route through it,
  at different heights so the route reads on top.
- A highlight follows the pointer, moved from `POINTERMOVE` inside the
  renderer. React never hears about hover.
- **The route preview is computed here, not in React.** `setMovement` hands the
  renderer the whole `Movement`, so `POINTERMOVE` can call `pathTo` on the
  hovered tile — recomputed only when the pointer crosses into a different
  tile. A route is drawn only to a tile in `reachable`, since `pathTo` also
  answers for tiles nobody may stop on.
- Unit meshes are built once at startup; there is no add or remove.
- `playEvents` walks `unitMoved` paths one tween per tile, 0.3s each
  (`FRAMES_PER_TILE` over `FRAME_RATE` in `units.ts` — one dial for every
  unit's pace).
- `snapUnits` positions meshes from state with no tween, stopping any running
  animation first.
- Babylon imports are **per-file**, not from the `@babylonjs/core` barrel. Side
  effect modules are imported where the augmented method is used:
  `Animations/animatable` for `beginAnimation`/`stopAnimation`, `Culling/ray`
  for `createPickingRay`. `Debug/debugLayer` and `@babylonjs/inspector` load
  via dynamic `import()` inside an `import.meta.env.DEV` guard, so neither
  ships in production.

## Configuration

One `.env`, at the repo root; bun does not walk up, so server scripts pass
`--env-file=../../.env`. A missing `.env` leaves the vars unset and the defaults
apply. `.env.example` is committed.

| | |
|---|---|
| `PORT` | server port, default 3001 |
| `DATABASE_URL` | `file:./packages/server/vod.db` locally, a `libsql://…` URL on Turso |

The client has no configuration.

## Testing

254 tests: 126 in `shared/`, 49 in `server/`, 79 in `client/`. `bun test` runs
the first two, Vitest the third; the root `test` script runs both.

- Server tests use `:memory:`. `match.test.ts` takes a fresh database per test;
  `http.test.ts` holds one server for the file and isolates per match.
- `http.test.ts` drives real `fetch` against `createServer({ port: 0,
  databaseUrl: ':memory:', clientDist: <fixture> })`. It never uses the real
  client build.
- Two suites use a temp directory and clean it up: `db.test.ts` for real
  database files, `http.test.ts` for its fixture dist. Nothing else touches the
  filesystem.
- Client tests use happy-dom and `@testing-library/react`. `src/test-setup.ts`
  registers `cleanup()`, which Testing Library cannot register itself here
  because this repo imports its test functions explicitly.
- `fetch` and timers are faked in `gameServer.test.ts`; every timer advance is
  the async form.

- React components are tested with the renderer mocked, so Babylon never
  loads: `GameCanvas` covers the chrome, the renderer lifecycle and the tile
  click; `MatchRoute` covers both failure branches, Retry, and disposal
  including a connection that resolves after teardown; `StartScreen` covers
  its four states and create-and-navigate.

**Not covered:** the renderer itself, which is WebGL — a browser is its only
check, and the `/run-app` skill drives the app headlessly for that. `App.tsx` is
a route table with no logic of its own.

⚠️ **`shared/`'s own test files are not typechecked** — see *Accepted limits*
in the roadmap. `server`'s and `client`'s test files are.

**Typechecking** reads `shared`'s source directly: `server` and `client` resolve
`@vod/shared` through its `exports` and pull that source into their own
programs. The root `tsconfig.json` is a solution file over those two only.
`shared` emits nothing. `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
`erasableSyntaxOnly` and `verbatimModuleSyntax` are on in all four tsconfigs.
`shared` has no program of its own — its config exists for editors, and its
source is checked inside the two programs that import it.

## Deployment

One process serves both: `Bun.serve` handles `/api/*` and serves
`packages/client/dist` for everything else. Handlers are stateless. In dev, Vite
proxies `/api` to the server so the same relative paths work.

Migrations run at boot. SQLite needs a persistent disk; an ephemeral filesystem
silently creates a fresh empty database on redeploy.
