# Victory or Death — Architecture

Turn-based strategy game, American Revolutionary War theme. React + TypeScript
+ Babylon.js, built with bun.

**This document describes the code as it is.** No rationale, no history. What
is planned but unbuilt lives in [`roadmap.md`](roadmap.md).

**What plays today:** hot-seat against a real server process. Select a unit, see
the tiles it can reach across terrain, hover to preview the route, click a
destination and watch the unit walk to it — then click the unit to stop there, a
tile beside it to end up looking that way, or anywhere else to think again —
end turn. Two players, one infantry, cavalry and artillery each, on an 8×8 map split
by a river with a single bridge. No combat.

## Packages

Three bun workspaces, split by authority. Installs are isolated rather than
hoisted, so a package can only import what it declares.

| Package | Depends on | Holds |
|---|---|---|
| `@vod/shared` | nothing | The rulebook: types, content tables, queries, movement, validation, resolution, the event fold, and the wire protocol. No I/O, no RNG, no React, no Babylon, no `Date.now()`. |
| `@vod/server` | `shared` | The authority: the database, the event log, match construction, and the HTTP surface. |
| `@vod/client` | `shared` | Presentation: Babylon rendering and glTF loading, input, React, and the HTTP `GameServer`. |

`shared` has two entry points, no build script, and emits nothing — `exports`
point at TypeScript source, which bun runs natively and Vite compiles:

- `.` → `src/index.ts`, the rulebook barrel. Holds only what `server` and
  `client` consume.
- `./testing` → `src/testing.ts`, fixtures, imported by tests only.

`server` has no barrel and no `exports`; `src/http.ts` is an entry point that
gets run. Nothing imports `server`.

Where things live. What a module exports is its own business — open the file
rather than look for a list here.

```
packages/
  shared/src/
    types.ts          every shared type: coordinates, units, state, commands, events
    coordinate.ts     grid arithmetic and directions
    queries.ts        lookups over a GameState
    legality.ts       what may be selected
    movement.ts       the search, the path check, and the cost model both call
    terrainGrid.ts    character rows into a tile grid
    action.ts         command validation and resolution, and the Action brand
    move.ts           the move command
    endTurn.ts        the end-turn command
    applyEvents.ts    the event fold
    protocol.ts       the GameServer interface, the wire shapes, and parsing
    testing.ts        fixtures, imported by tests only
    index.ts          the barrel
    data/             the static content tables — unit types and terrain
  server/
    src/
      http.ts         createServer() — Bun.serve routes, /api/* plus the client build
      match.ts        MatchStore — the only reader and writer of matches
      db.ts           libSQL client + Drizzle, pragmas, migrations at boot
      schema.ts       matches · resolutions, typed from shared
      matchState.ts   instantiates a map into the board a match starts from
      maps/           the map registry, and the maps themselves
      const.ts        env-derived defaults
    drizzle.config.ts drizzle-kit config; imports DEFAULT_DB_URL from const.ts
    drizzle/          generated migrations, committed
    schema.sql        the whole current shape in one file
  client/
    index.html  vite.config.ts  public/  scripts/compressDist.ts
    src/
      main.tsx · App.tsx · index.css · test-setup.ts
      routes/     the two screens
      net/        the HTTP client and the polling GameServer
      game/       the session hook and the canvas component
        interaction/  click handling, pure
        render/       everything Babylon touches
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
| `bun run format` / `format:check` | Prettier (Markdown and exported glTF are excluded) |
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
Facing      'north' | 'east' | 'south' | 'west'      // chosen by the player; no rule reads it yet
PlayerId    string                                   // never a union of colours
PlayerColor 'blue' | 'red' | 'green' | 'yellow'      // the renderer keys on it
Player      { id, name, color }                      // colour is display-only
Unit        { id, position, facing, unitTypeId, owner, hasActed }
GameState   { grid, units, players, currentTurn }    // grid is [row][col]

Command       MoveCommand { type, unitId, path, facing } | EndTurnCommand { type }
Action        (MoveCommand & Validated) | (EndTurnCommand & Validated)
              -- a union of intersections, not Command & { actor }: the
              latter would admit an endTurn carrying a path
GameEvent     UnitMovedEvent { type, unitId, path, facing } | TurnEndedEvent { type, nextPlayer }

ValidationResult  { ok: true, action } | { ok: false, reason }
CommandResult     { ok: true, seq, events, state } | { ok: false, reason }
StateResponse     { seq, state }
EventsResponse    { seq, events, state? }
MatchSummary      { id, createdAt, seq, currentTurn, mapId }
MapSummary        { id, name }                       // GET /api/maps
ErrorResponse     { error }                          // the body of every non-2xx
```

Turn order is array rotation over `GameState.players`, wrapping via modulo.
`hasActed` is one flag per unit, set by `unitMoved` and reset by `turnEnded` for
the incoming player only.

`facing` is **carried, not derived**. The player picks it, so it need not agree
with the direction of travel — a unit can end a move looking somewhere it did not
come from, which is exactly what a derivation could not express. The client
proposes the travel direction as a default (`directionBetween`), the command
carries the answer, and `parseCommand` refuses anything but one of the four.
A single-element path plus a facing is a **turn in place**, and it spends the
unit's turn like any other action.

## Content — `shared/src/data/`

Static tables keyed by `Record`, so adding a member makes every incomplete table
a compile error. **The values are the modules' — read them there.** Both are
short, and a copy here would be a second set of numbers to tune.

**`unitTypes.ts`** — `{ id, name, movementType, movementRange }` per type.
`movementType` is `foot`, `horse` or `wheels`, and picks a column out of the
terrain cost table; `movementRange` is the budget that column is spent against.

**`terrain.ts`** — `{ char, defense, cost }` per terrain. `char` is the symbol a
map is drawn with; `defense` is stars of cover, read by nothing yet; `cost` is
movement points to *enter*, one per movement type, with `null` for impassable —
which is what makes a river a wall to wheels and a toll to boots. ⚠️ Costly and
impassable are deliberately different answers, and a mountain is where that is
tuned: 4 against a cavalry's range of 5 puts a peak within reach only from close
by, while `null` for wheels shuts it outright.

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

`getMap` throws on an unknown id, and **`rows[0]` is the row nearest the
camera** — row index increases north, so a map written out top-down is upside
down in the source.

| | |
|---|---|
| `classic` | 8×8. A river split by one bridge, mountains flanking the far approach and forest the near one, so infantry ford where cavalry and artillery take the bridge |
| `crossroads` | 10×10. A road network closed into a figure of eight, no water and no mountains |
| `two-bridges` | 12×10. One river bent through a right angle, with a bridge across each arm — so both bridge orientations appear on one board, and the river cuts it into three |
| `lakeland` | 12×12. A lake with an island only infantry can reach, mountains north, woods on both shores, and a one-tile pond |

`StartScreen` picks between them and `POST /api/matches` carries the choice;
omitting it takes `DEFAULT_MAP_ID`.

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
GET  /api/maps                        → MapSummary[]
GET  /api/matches                     → MatchSummary[]           (newest 50)
POST /api/matches   { mapId? }        → MatchSummary             201
                                      | { error }                400 unknown map
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
parses no boards. `map_id` is read only to label a match in the list — replay
never needs it, because `initial_state` already holds the instantiated board.
`action` is written and never read.

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

**`routes/`** — `/` is `StartScreen` (list, and create on a chosen map — the
picker simply does not appear if `GET /api/maps` fails, which falls back to the
server's default and is what happened before there was one); `/:matchId` is
`MatchRoute`, which is keyed on the id so a param change remounts the
connection. It owns the async connect, renders `GameCanvas` only once a server
is ready, and disposes on unmount including a connection that resolves after
teardown. A failure renders one of two things, which is what `FailureKind` is
for: `notFound` offers a link back and no retry, `unreachable` offers a working
Retry that re-runs the connect.

**`game/useGameSession.ts`** — the session: render replica, rejection state,
in-flight guard, selection, and submits. Takes `onEvents` and `onSnap` callbacks
held in a latest-ref, so the subscription depends on `server` alone.

Selection is React state and is **returned** rather than pushed through a
callback, so it has one copy: whoever renders it and whoever reads it to compute
the next click see the same value. `pendingRef` stays a ref — it is a mutex
against a second submit landing before the first resolves, and has to be
synchronously current rather than rendered.

⚠️ `clickTile` and `endTurn` are the only verbs left. A pinned plan is
committed *and* abandoned by a click on the board — the tiles a pinned
destination lights are the whole menu, and everything else is the way out. A
refused
submit rolls back to the unit **selected**, not to the destination the server
just refused — handing that back would invite confirming the same move again.

Pinning a destination starts a **preview walk**: the unit moves on screen while
nothing has been sent. `onPreview(next | null)` drives it, and the two cases it
is *not* called on are the design — a confirm and an incoming update both end
with `onSnap` writing an authoritative position over the mesh, so the correction
the renderer already performs is the instruction, and there is no commit verb. It
*is* called on a rejection, which is the one ending that produces no update at
all.

⚠️ `walking` is true until the preview settles, and **nothing a pinned selection
offers is answerable during it** — `playEvents` skips a move only once its mesh
stands at the destination, so committing early would replay the committed move
from halfway along the path. That is why `clickTile` closes over `walking`
rather than reading it from a render that may predate the walk.

Every update runs through a serial promise queue:

```
on update (events, state):
  clear the rejection                       -- immediately, on arrival
  enqueue:
    if worthAnimating(events): await onEvents(events)
    onSnap(state)
    commit state
```

`worthAnimating` is false for an empty batch, while the tab is hidden, and for
a batch covering more than 28 tiles of walking. The budget counts **tiles, not
events**, because one `unitMoved` can be a six-tile walk and every unit moves at
the same pace — so tiles are what the wait is made of, and the ceiling moved
when the pace did. A failing animation or
snap is caught and logged; the commit always happens.

**`game/interaction/selection.ts`** — pure: no React, no server.

```ts
handleTileClick(state, selection, coordinate) → SelectionState
facingChoiceOrigin(pinned)                    → Coordinate
facingChoiceAt(pinned, coordinate)            → Facing | null
waitFacing(state, pinned)                     → Facing | null
unpinDestination(pinned)                      → SelectionState
moveCommandFor(pinned, facing)                → Command
```

`handleTileClick` **never produces a command** — it picks a destination, and
nothing more. ⚠️ A click *can* commit, but the phase dispatch that decides so
lives in `clickTile` above it, which is why this stayed selection-only: every
command's accompanying selection is a constant the caller already knows, so a
paired return would carry no information.

```ts
| { phase: 'idle' }
| { phase: 'unitSelected'; unitId; position; movement }
| { phase: 'destinationChosen'; unitId; path; movement }
```

`movement` is the whole `exploreMovement` result, snapshotted at selection time.
`reachable` decides whether a click pins; `pathTo` builds the path.

A pinned destination is a **plan, not a submission** — nothing has been sent, and
a click that means nothing else discards it without the server hearing.
`path[0]` is where the unit still
stands, so unpinning needs no extra field, and the selected unit's own tile is a
destination like any other: that is how acting without moving needs no gesture of
its own, and a single-element path is legal at cost 0. While a destination is
pinned, `handleTileClick` returns the **same object** it was given — the caller
has already read the click as a direction or a wait, and a re-render for a click
that changes nothing is waste.

⚠️ **`destinationChosen` is also the facing choice**, which used to be a phase of
its own. Once the preview arrives, the tiles around the unit are the menu: a
click on the destination keeps the direction travelled (`waitFacing`), a click on
one of the four beside it overrides that (`facingChoiceAt`), and **either commits**
— the direction is the last decision, so there is nothing left to confirm.
Anything further away is ignored. Facing is therefore *offered* rather than
demanded, which is what the design always asked for.

⚠️ The two answers cannot collide: `facingChoiceAt` returns `null` for the
destination itself, because `directionBetween` wants a step of exactly one tile.
`waitFacing` is the only one that needs `GameState`, for the case with no last
step to read — acting without moving keeps the facing the unit already had. The
unit is already standing in the direction it walked, so keeping that facing is a
click on the tile it is looking
at. The renderer clips the four to the board, which costs nothing: facing off the
edge is a strictly worse choice than any of the alternatives.

**`game/GameCanvas.tsx`** — the canvas ref, the renderer lifecycle, and the
chrome around it: the turn label, End Turn, the rejection reason, the
reconnecting banner, and a Toggle Inspector button under an
`import.meta.env.DEV` guard, plus a hint line while a destination is pinned. End
Turn is disabled while pinned, since ending the turn there would submit around a
plan the player has not answered for.

⚠️ The tile menu lights **on arrival** rather than on pin: an inert lit tile
invites a click that does nothing. So `showSelection` is a projection of the
selection *and* `walking` — the range stays lit while the unit walks, as the
context the choice was made against, and comes down as the menu lights. ⚠️ The
hint line is the only thing naming any of the gestures, since there are no
buttons left to name them.

Its two callbacks read the renderer ref at call time, so a queue task resolving
after unmount finds `null` rather than a disposed renderer.

Selection reaches the renderer as a projection: an effect keyed on it calls
`showSelection`. The tile-click handler, by contrast, is registered **once**, as
a stable wrapper over a latest-ref — `clickTile` changes identity with every
selection, and re-registering it would mean putting it in the construction
effect's dependencies and rebuilding the scene on every click. Registration
cannot be its own effect either: construction is async, so such an effect would
run while the renderer ref is still `null` and nothing would re-run it.

## Rendering

`createGameRenderer(canvas, initialState)` is **async** — it loads the unit
models before any unit exists, so that no window opens in which a unit has state
but no mesh. `GameCanvas` disposes a renderer that finishes building after
unmount. It resolves to:

```ts
onTileClick(handler)      setSelectedTile(coordinate | null)
setMovement(movement)     setFacingChoices(around | null)
playEvents(events): Promise<void>
snapUnits(state)          previewMove(unitId, path): Promise<void>
cancelPreview()           toggleInspector()          dispose()
```

- **Camera:** `ArcRotateCamera` in `ORTHOGRAPHIC_CAMERA` mode, starting at a
  fixed isometric angle. Orbit stays on the default input; **wheel zoom does
  not**. An orthographic camera's apparent size comes entirely from its ortho
  bounds, so moving along `radius` changes nothing visible and only walks the
  camera toward the board until the near plane clips it. The wheel input is
  removed, `radius` is pinned by matching limits, and a listener on the canvas
  scales a zoom factor that the ortho bounds divide by — clamped, and removed in
  `dispose()` alongside the `resize` listener. Bounds are recomputed from grid
  size, aspect and zoom.
- **Tile lookup is math, not mesh-picking** — but no longer against *one* plane.
  `screenToTile` tries each distinct surface height the board has, **tallest
  first**, and takes the first answer that agrees with itself: the tile found at
  height `h` must be a tile whose surface is at `h`. Tallest first is what lets
  a peak win over the plains it occludes. Cheap, because a board has two or
  three distinct heights. Terrain meshes stay `isPickable = false` and Babylon's
  mesh picking stays out of it. ⚠️ Clicking the *side* of a raised tile agrees
  with nothing, so the flat reading is kept as a fallback.
- **Elevation is visual only; the map data has no height.** A tile's walkable
  surface is `surfaceAt(coordinate)` in `renderer.ts`, the one place any `y` is
  decided — terrain props, units, the walk tween, `snapUnits`, `cancelPreview`,
  every overlay and now picking read it, so a raised tile cannot be raised for
  some of them and not others. Three ways a cell can say how high it is, in
  order of preference:
  - Nothing at all, and `terrainModels.topOf` **measures** the ground model's
    bounding box at load. Derived from the art, so swapping a model moves the
    surface with it.
  - `TerrainCell.standOnProp` — the index of a prop a unit stands **on top of**,
    whose height is likewise measured. A mountain is this: an ordinary grass
    tile with a mesa standing on it.
  - `TerrainCell.standOn` — a *declared* offset, for the one case measurement
    gets wrong: standing **partway up** a prop. A bridge deck is 0.15 on a model
    that reaches 0.35, because its own top is the handrail.
  - ⚠️ **`MAX_STAND_HEIGHT` is 0.5, and it is a legibility limit rather than a
    picking one.** Picking now finds a peak however tall it is. What binds is
    the camera: at 38.6° a surface at height `h` *draws* `1.25h` tiles up-screen
    of its own tile, and past about half a tile it visually occupies its
    neighbour whether or not the click lands right. A voxel spike put this at a
    full tile and tile identity fell apart on sight.
- The models are [Kenney's Nature Kit](https://kenney.nl/assets/nature-kit),
  CC0, as GLB — the loader units already use. What the code relies on, measured
  rather than assumed: ground tiles are **exactly 1×1 in x and z**, which is
  `TILE_SIZE`, so nothing is scaled; they carry no textures, only flat material
  colours; they are multi-mesh **split by material**, with about eight materials
  serving the whole set, which is what makes merging by material worth doing;
  and every model hangs under a node translated **−0.05 in y**, so reading the
  position accessors gives heights a uniform 0.05 too high. ⚠️ `bridge_wood` is
  1.04 square rather than 1.00 and so overhangs its tile by 2% a side. That is
  deliberate — a deck rests *on* its banks — and is recorded here so nobody
  later "corrects" it.
- Terrain is built from **glTF models**, one per tile, and then **merged by
  material** — grouping every tile's meshes by material leaves about fourteen
  draw calls for a board, against several hundred as loose copies. ⚠️ That
  number grows with the *palette*, not the board: it was eight before scenery,
  a mesa and six kinds of tree arrived, and each genuinely new colour costs one.
  Which is why a doodad painted in a material the board already has is free and
  a flower is not. Merging is right because
  terrain is made once and never moves. `terrainModels.ts` loads the set and
  shares one material per name across all of them, which is what makes the
  grouping work. ⚠️ Three families are recoloured, all for the same reason — the
  kit reuses a handful of materials and it twice made two kinds of tile the same
  object. A **road** shares `dirt`/`dirtDark` with a riverbank and gets grey
  gravel; a **mesa** shares the same warm orange and gets grey stone, keeping
  its grass cap; and **scenery on grass** is painted the exact green of the
  ground it stands on, which makes a tuft invisible by construction, so it gets
  a warmer, lighter green. An override supplies a *name* as well as a colour,
  since the name is what merging groups on.
- ⚠️ The loaded PBR materials are **replaced** with flat `StandardMaterial`s
  carrying their albedo. The kit ships `metallicFactor: 1`, and a fully metallic
  surface has no diffuse response — with no environment map to reflect, the
  whole board renders blank white. Flattening also puts terrain and units in one
  lighting model, both matte.
- `composeTerrain.ts` decides each cell's model and quarter turns, purely: a
  4-bit neighbour mask (`N=1, E=2, S=4, W=8`) indexes a table per family. A
  bridge belongs to **both** families — it is water with a road over it — so a
  river is not broken by its own crossing. Off-board counts as water for water,
  so a river runs off the edge, and as land for roads, so a road ends.
- **A quarter turn replaces twelve of the sixteen sprites a tileset would need.**
  Base orientations are measured off the geometry, not assumed: `riverStraight`
  runs north–south at rest, `riverSide` banks south, `riverCorner` opens north
  and west. Water uses the *body* vocabulary and roads the *connector* one,
  since a road is never a body of anything.
- The kit ships **two** water vocabularies — a body set for lakes and a channel
  set (`Bend`, `Cross`, `Split`) for one-tile rivers — and a 4-bit mask cannot
  tell which a cell wants: water north and east is a lake's corner if the
  north-east diagonal is water and a channel's bend if it is land. **The body
  set alone is used, and it is enough.** A one-tile river bending was the case
  that would have forced the diagonal test, and it reads correctly on `Two
  Bridges` — at one tile wide a rounded lake corner and a channel bend are near
  enough the same shape. The discriminator stays unwritten until something
  actually reads wrong.
- Three things the mask alone cannot answer: an **inner corner** needs a
  diagonal, so mask 15 with exactly one land diagonal takes a corner model;
  **bridge orientation** comes from strictly-road neighbours, because a two-lane
  crossing gives its decks masks 7 and 13 rather than 5 and 10; and a bridge is
  a model standing *on* water rather than ground of its own, which is why it
  carries the one `standOn` in the renderer.
- Anything standing on a tile rather than being it is a **`Prop`**, and the
  tiler fills in all of it — model, offset, free rotation, scale. `terrain.ts`
  obeys and decides nothing, which is what keeps *where a tree goes* out of the
  drawing code and in the one module that is pure and tested.
- ⚠️ **Never the middle of a tile**, since a unit stands there — that is
  `KEEP_CLEAR`, and it binds anything a unit shares its tile with. The two props
  it does *not* bind are the ones a unit stands **on**: a bridge deck and a
  mesa, both dead centre on purpose. Everything is placed from a deterministic
  per-tile value stream, so the board never reshuffles between scene builds.
- A **mountain is a mesa on an ordinary tile**, not raised ground. The trade is
  deliberate: a block fills its square and keeps every overlay flush but reads
  as masonry, while a rock does not fill a square — the hover and range tints
  sit at the mesa's height and float past its sloping edges — and reads as
  terrain, which is worth more.
- **Woodland is six tree shapes**, each turned and scaled, because one shape
  stamped repeatedly reads as wallpaper. Free: every one is painted `woodBark`
  and `leafsGreen`, which a single tree already brought. The kit's pines each
  carry two more materials, which is why none is used.
- **Open ground carries light scenery** — grass tufts, a small bush, the odd
  flower, on about a third of plains tiles. ⚠️ None of it means anything: a tile
  with a flower plays exactly like one without, and the scatter stays thin
  precisely so it does not read as a feature worth asking about.
- Grid lines are **one flat grid at the board's floor**, mid grey at 7%. Flat
  is correct rather than a compromise: a mountain raises a *rock*, not its
  ground, so every tile's floor is the same plane. ⚠️ They were briefly a square
  per tile at each tile's own surface, for a raised-ground design that no longer
  exists — and long spans are better anyway, since each interior edge is drawn
  once rather than by both its tiles, so the alpha means what it says.
- A highlight follows the pointer, moved from `POINTERMOVE` inside the
  renderer. React never hears about hover.
- **The route preview is computed here, not in React.** `setMovement` hands the
  renderer the whole `Movement`, so `POINTERMOVE` can call `pathTo` on the
  hovered tile — recomputed only when the pointer crosses into a different
  tile. A route is drawn only to a tile in `reachable`, since `pathTo` also
  answers for tiles nobody may stop on.
- Units are glTF models from `public/models/`, one per unit type, loaded once
  into `AssetContainer`s and instantiated per unit. Each instance is parented to
  a `TransformNode` of ours: the loader's own `__root__` carries the
  right-handed-to-left-handed conversion as a negative scale, and a facing
  rotation set on that node would compose with the flip and turn the unit the
  wrong way. Models face `+Z`, which is north here, so there is no offset.
- One `StandardMaterial` per player colour, looked up by name so the scene is
  the cache. The models arrive untextured and near-white, so colour is the whole
  of a side's identity. Matte like the terrain — specular is zeroed — plus a
  floor of `emissiveColor` at 28% of the diffuse: units are mostly vertical and
  the only light is hemispheric from above, so their sides fall into shadow
  exactly where the silhouette has to read. Colours are picked to sit against
  the board rather than to be canonical, and green leans to lime because a true
  green sits almost on the grass.
- Model origins are at the base, so a unit's `y` is the surface it stands on
  rather than half its own height.
- Unit meshes are built once at startup; there is no add or remove.
- `playEvents` walks `unitMoved` paths one tween per tile, 0.15s each
  (`FRAMES_PER_TILE` over `FRAME_RATE` in `units.ts` — one dial for every
  unit's pace). Each step turns the mesh before it moves, so a unit walks the
  way it is looking; the turn is snapped rather than tweened.
- `snapUnits` positions *and* orients meshes from state with no tween, stopping
  any running animation first, and **ends any preview**: authority overwrites
  every position, so there is no separate commit step.
- **The preview** is one nullable `{ unitId, origin, facing, settle }`. Arriving
  and ending are separate moments: the walk resolves the promise, but the record
  outlives it, because a cancel *after* the unit lands is exactly when something
  needs to know where to put it back. The promise means *the preview settled*,
  which includes a cancel or a snap ending it early — `stopAnimation` fires no
  end callback, so a promise tied to the tween alone would hang and whatever
  waits on it would never proceed.
- `playEvents` **skips a `unitMoved` whose mesh already stands at the path's
  destination**. A confirmed preview has walked the unit there, and replaying
  would send it back to the second tile and forward again. Positional rather
  than a flag, and sound because the menu only opens once the walk has arrived.
- `setUnitFacing` is the only writer of `rotation.y`, so replacing the
  models' orientation a single constant.
- Babylon imports are **per-file**, not from the `@babylonjs/core` barrel. Side
  effect modules are imported where the augmented method is used:
  `Animations/animatable` for `beginAnimation`/`stopAnimation`, `Culling/ray`
  for `createPickingRay`, and `@babylonjs/loaders/glTF/2.0` to register the
  glTF plugin — the `2.0` entry point specifically, since the package root
  would also pull the legacy 1.0 loader. `Debug/debugLayer` and `@babylonjs/inspector` load
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

Every package is tested. `bun test` runs `shared` and `server`, Vitest runs
`client`, and the root `test` script runs both.

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
  loads: `GameCanvas` covers the chrome, the renderer lifecycle, the tile click
  and what a pinned destination projects at each stage of the walk; `MatchRoute` covers both failure branches, Retry, and disposal
  including a connection that resolves after teardown; `StartScreen` covers
  each of its states and create-and-navigate.

- `composeTerrain` is the one piece of the renderer that is pure, and it is
  tested like any other pure module — including that no cell declares a
  `standOn` above the picking ceiling. The other half of that ceiling is how
  tall a *model* measures, which nothing can know without loading it, so
  `warnIfTooTall` checks it at startup instead. ⚠️ An asset test would need
  `node:fs`, and `client/src` is deliberately a browser-only program with no
  Node types — the same boundary that makes a stray `import 'react'` in
  `server/` a resolution error.

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
