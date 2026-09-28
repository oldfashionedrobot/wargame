# Wargame — Architecture

Turn-based strategy game, American Revolutionary War theme. React + TypeScript
+ Babylon.js, built with bun.

**This document describes the code as it is.** No rationale, no history — the
reasoning lives in `git log`, where the commit that made a decision is the thing
that explains it. What is planned but unbuilt lives in
[`roadmap.md`](roadmap.md).

**Values live in the modules, not here.**

**What plays today:** hot-seat against a real server process, from the opening
move to a winner. Select a unit and see the tiles it can reach across terrain;
click a destination to pin the route there and click it again to send the unit
walking. Where it arrives a panel asks what it is doing — hold, fire or charge,
listing only the ones it can actually do and skipping itself when that leaves
one — after which a held unit is pointed somewhere, since facing decides whether
a shot is answered. A shot or a charge
cuts away to the two units and plays the exchange. Every unit acts once and the
turn ends when the last of them has gone; when a player has nothing left, the
match is over and says so.

Two players, a rank of eight each — two guns, two horse, four foot — on a map
chosen when the match is created. `/maps` shows the boards without starting
one.

## Packages

Three bun workspaces, split by authority. Installs are isolated rather than
hoisted, so a package can only import what it declares.

| Package | Depends on | Holds |
|---|---|---|
| `@wargame/shared` | nothing | The rulebook: types, content tables, queries, movement, validation, resolution, the event fold, and the wire protocol. No I/O, no RNG, no React, no Babylon, no `Date.now()`. |
| `@wargame/server` | `shared` | The authority: the database, the event log, match construction, and the HTTP surface. |
| `@wargame/client` | `shared` | Presentation: Babylon rendering and glTF loading, input, React, and the HTTP `GameServer`. |

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
    coordinate.ts     grid arithmetic, directions, distance, and neighbours
    queries.ts        lookups over a GameState
    legality.ts       what may be selected
    movement.ts       the search, the path check, and the cost model both call
    terrainGrid.ts    character rows into a tile grid
    armyGrid.ts       character rows into unit placements
    action.ts         command validation and resolution, and the Action brand
    move.ts           the move command
    endTurn.ts        the end-turn command
    turns.ts          the action budget, and whose turn is next
    combat.ts         both attacks: damage, ranges, the counter rule, charge
    victory.ts        who has won, and whether anyone has
    applyEvents.ts    the event fold
    protocol.ts       the GameServer interface, the wire shapes, and parsing
    testing.ts        fixtures (makeState, route, at, unitAt), tests only
    index.ts          the barrel
    data/             the static content tables — unit types, terrain, combat
  shared/scripts/
    matchups.ts       prints hits-to-kill
    charges.ts        prints charge odds against the repel band
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
      main.tsx    the entry point; App.tsx is the route table beside it
      routes/     the top-level screens
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
| `bun packages/shared/scripts/matchups.ts` | Tuning harness: hits-to-kill for every matchup on every terrain |
| `bun packages/shared/scripts/charges.ts` | Tuning harness: charge odds for all three approaches on every depth of cover, and what failing costs |
| `bun packages/server/scripts/simulate.ts [games] [map] [opener] [budget] [blueArmy] [redArmy]` | Plays the game against itself with a greedy bot and reports outcomes, match length, damage by unit type, and whether each mechanic fired. An army is comma-separated rows; omitted, both sides take the default deployment |
| `bun run preview` | `vite preview` — the built client with no `/api` proxy, so it reaches no match |
| `bun run --filter '@wargame/server' start` | The production shape: one process serving the API and `dist` together |

Single test file: `bun test packages/server/src/match.test.ts` (`-t 'name'` to
filter); client: `cd packages/client && bunx vitest run src/net/gameServer.test.ts`.

`db:*` must run from the root: `file:` URLs in `DATABASE_URL` resolve against
the repo root, and running them through `bun run --filter` sets the cwd to the
package and loses the single root `.env`.

## The pipeline

```ts
validateCommand(state, command, actor)  → { ok: true, action } | { ok: false, reason }
resolveAction(state, action, rolls)     → GameEvent[]
applyEvents(state, events)              → GameState
```

`rolls` is an argument, never a field on `Action`: `shared/` produces no
randomness (invariant 2), so the server rolls and passes them in. `endTurn`
ignores the argument.

| | Direction | Contents |
|---|---|---|
| `Command` | client → server | Intent only. No actor, no dice. Can be rejected. |
| `Action` | inside the server | An accepted `Command`, plus `actor`. Carries a `unique symbol` brand that is never exported, so it can only come from `validateCommand`. |
| `GameEvent` | server → clients | A fact that already happened. What clients animate. |

`validateCommand` checks `actor === state.currentTurn` first, then refuses
everything if the game is over, then dispatches to the per-command validator.
`resolveAction` accepts nothing but an `Action`.

The terminal refusal sits one line above the dispatch rather than inside each
validator, so it covers command types that do not exist yet. The order is
identity, then terminal state, then the per-command check.

## Rules that hold

1. **The database is the only mutable state.** No module-level mutable state
   exists in `server/`; every request reads, computes, and writes back.
2. **`shared/` is pure** — no I/O, no RNG, no Babylon, no React, no `Date.now()`.
   The compiler enforces it through the client: `shared` has no program of its
   own, and `client`'s has no node or bun globals, so `process.env` in the
   rulebook fails the build there.
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
Facing      'north' | 'east' | 'south' | 'west'      // read by the counter rule; see Combat
PlayerId    string                                   // never a union of colours
PlayerColor 'blue' | 'red' | 'green' | 'yellow'      // the renderer keys on it
Player      { id, name, color }                      // colour is display-only
Unit        { id, position, facing, unitTypeId, owner, health, hasActed }
GameState   { grid, units, players, currentTurn,
              winner }                               // grid is [row][col]; winner is null while playing

Command       MoveCommand { type, unitId, path, facing, targetUnitId?, attackKind? }
            | EndTurnCommand { type }
Action        (MoveCommand & Validated) | (EndTurnCommand & Validated)
              -- a union of intersections, not Command & { actor }: the
              latter would admit an endTurn carrying a path
GameEvent     UnitMovedEvent { type, unitId, path, facing }
            | TurnEndedEvent { type, nextPlayer }
            | BattleResolvedEvent { type, kind, attacker, defender, answered }
              -- attacker/defender are { unitId, health }, resulting
            | GameEndedEvent { type, winner }
              -- never emitted beside a TurnEndedEvent

ValidationResult  { ok: true, action } | { ok: false, reason }
CommandResult     { ok: true, seq, events, state } | { ok: false, reason }
StateResponse     { seq, state }
EventsResponse    { seq, events, state? }
MatchSummary      { id, createdAt, seq, currentTurn, mapId, winner }
MapSummary        { id, name }                       // GET /api/maps
MapPreview        { id, name, state }                // GET /api/maps/:id/preview
ErrorResponse     { error }                          // the body of every non-2xx
```

**A turn is a budget of actions**, `ACTIONS_PER_TURN` in `turns.ts`, and the
turn ends itself once the budget is spent. It is **`null`** — no cap: every
unit acts once, the player picks the order, and the turn ends when the last of
them has gone. A number caps it instead.

⚠️ **Under a cap, nothing forces rotation.** `turnEnded` refreshes `hasActed`
for the incoming player's whole roster, so at a budget of one the same unit may
act on consecutive turns indefinitely while the rest never move. Uncapped this
is invisible — the roster *is* the budget, so everyone acts once by
construction. It is a property of the budget rather than a separate rule, and
it is what a cap has to reckon with.

⚠️ **The budget is reachable as an argument**, on `actionsAllowed`,
`actionEndsTurn` and `resolveAction`, each defaulting to the constant. Tests
pass it explicitly and cover both regimes, so moving this line moves the game
without moving the suite.

`null` rather than `Infinity`, because `Infinity` does not survive
`JSON.stringify`. The branch tests `=== null`, not `== null` — the loose form
would swallow an explicitly passed `undefined`, which has to fall through to the
default.

```ts
actionsTaken(state)    // this player's units with hasActed set
actionsAllowed(state)  // min(ACTIONS_PER_TURN, this player's roster)
actionEndsTurn(state)  // does one more action finish the turn
```

The `min` covers a player with fewer units than the budget: "everyone has acted"
finishes a turn as surely as "the budget is gone".

`actionEndsTurn` needs no state fold — an action sets `hasActed` on exactly one
unit that lacked it, so the count afterwards is the count now plus one.

The budget is a **default argument** rather than read from the module, so tests
can exercise the arithmetic at any value.

`resolveAction` appends `turnEnded` to a move that spends the turn, reusing
`resolveEndTurn` so exactly one place decides who plays next. **Two events,
never one carrying both effects** — invariant 9.

**The End Turn command is the early exit**: a player may stop before committing
every unit they are allowed to. At a budget of 1 it is a pass.

Turn order is array rotation over `GameState.players`, wrapping via modulo.
`hasActed` is one flag per unit, set by `unitMoved` and reset by `turnEnded` for
the incoming player only.

`winner` is `null` until somebody wins, and **additive: `currentTurn` is never
cleared beside it**. `getCurrentPlayer` throws when `currentTurn` names nobody,
and the client's turn label calls it every render. `winner` is nullable on the
state and not on the event.

`facing` is **carried, not derived**: the player picks it, so it need not agree
with the direction of travel. The client proposes the travel direction as a
default (`directionBetween`), the command carries the answer, and `parseCommand`
refuses anything but one of the four. A single-element path plus a facing is a
**turn in place**, and it spends the unit's turn like any other action.

**A defender's facing is never changed by being shot at.** It answers from where
it was left looking.

## Content — `shared/src/data/`

Static tables keyed by `Record`, so adding a member makes every incomplete table
a compile error. **The values are the modules' — read them there.**

**`unitTypes.ts`** — `{ id, name, char, movementType, movementRange, range, slow }`
per type. `range` is `{ min, max }` tiles, inclusive, read by `refuseAttack`,
`tilesInRange` and `wouldCounter`. ⚠️ **It classifies nothing:** there is no
direct/indirect flag, and `min: 3` describes a gun rather than naming a kind of
one — which is what lets a single rule ask "is the attacker inside my own range"
and get an answer for every unit.

⚠️ **`slow` is the one thing no distance could express**, and it is a flag
because what it governs is a *turn* rather than a gap: a slow unit may move or
attack, never both, and never answers a shot. See *Slow* below.
`movementType` is `foot`, `horse` or `wheels`, and picks a column out of the
terrain cost table; `movementRange` is the budget that column is spent against.
Also `MAX_HEALTH`, a constant beside the interface rather than a field on it:
nothing varies it, so a per-instance copy would be one number written once per
unit. ⚠️ It lives here so that the day some unit is tougher than another, it
becomes a column of `UnitType` and the edit is local.

**`combat.ts`** — every number combat reads, and nothing else. Three tables:
`BASE_DAMAGE` (attacker → defender, as a percentage of a full-health target),
`CHARGE_THRESHOLD` (a `Partial`, where the *missing* artillery row is how
"artillery cannot charge" is said) and `CHARGE_REPEL` (keyed by who is being
charged). Then the scalars, each explained where it is used rather than here:
`TERRAIN_WEIGHT` and `LUCK_MAX` in *Combat*; `CHARGE_HALF_LIFE`,
`FRONTAL_FLOOR`, `FLOOR_PER_STAR` and `REPEL_DIVISOR` in *Charge*;
`FLANK_MULTIPLIER` and `REAR_MULTIPLIER` in *Charge*, and
`FLANK_COUNTER_SHARE` in *A shot from behind*.

⚠️ `BASE_DAMAGE` is a matrix rather than an attack stat and a defence stat: no
pair of scalars can express rock-paper-scissors, since any `f(attack, defence)`
is transitive.

**`terrain.ts`** — `{ char, defense, cost }` per terrain. `char` is the symbol a
map is drawn with; `defense` is stars of cover, read by `computeDamage` and
scaled there by `TERRAIN_WEIGHT` — a star is worth 15% at full defender health,
and the column itself does not know that. ⚠️ **Open ground carries none**: road,
bridge, plains and river are all 0, cover starts at `forest` 2 and tops out at
`mountain` 4, and **no terrain sits at 1 star** — a single star moves the hit
count in two matchups of nine, so it would draw a `★` the arithmetic cannot pay
out. `cost` is
movement points to *enter*, one per movement type, with `null` for impassable —
which makes a river a wall to wheels, a toll to boots, and most of a turn to a
horse. Costly and impassable are different answers: a mountain is expensive for
horse and `null` for wheels.

⚠️ **`road` and `bridge` are identical in *both* columns**, so they are
indistinguishable to every rule that reads them — the split exists only so the
renderer can draw a crossing over water. Plains and river match them on
`defense` alone and differ on `cost`.

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
}
```

**A map is terrain and nothing else.** Units are deployed onto it by
`createMatchState`, which takes a **`Deployment` per player** — that player and
the army they field — defaulting to one hardcoded pair beside the hardcoded
`PLAYERS`, because nothing *chooses* an army yet.

```ts
interface Deployment { player: Player; army: string[] }
interface DeploymentZone { width: number; depth: number }
```

⚠️ **The army binds to the player; the seat stays positional.** Pairing the two
is what stops a second array agreeing with `PLAYERS` by index — but the *edge*
is still read off list order: first deploys on the near edge looking north,
second on the far edge looking south. **The two sides need not match**, in
composition or in count.

⚠️ **An army is not on `Player`, and what decides that is who reads it.**
`Player` lives in `GameState`, which is JSON in two columns on every write, and
no rule reads an army — once units carry `owner` it has done its job and is
derivable by grouping them.

**Units are placed in a `DeploymentZone`**, `DEPLOYMENT_ZONE` in `matchState.ts`:
a rectangle on the player's own edge, centred on the board's width. ⚠️ **An army
grid is exactly the zone's size, not merely bounded by it** — padded with
empties, which is what makes an *offset* deployment expressible at all:

```
'iiii......'    // four foot on the player's own left
'...iiii...'    // the same four, centred
```

⚠️ **The margin is therefore a property of the zone and not of the army.**
Nothing about centring varies with what is fielded, so `armyWidth` is read as a
*check* — is this grid the zone's width — rather than as an input to the sum. A
grid of the wrong size is refused, naming the player whose army it is.

⚠️ **The zone is assumed, not declared by the map.** Every board is 12×12, so the
rows nearest each edge are simply taken. **Reachable as an argument**, the shape
`ACTIONS_PER_TURN` has and for the same reason: the suite deploys onto boards
this game never ships.

Parsed by `parseArmyGrid` over a `char` column on `UnitType`, the same shape
terrain has. ⚠️ `.` means *empty* in an army and *plains* in a map — one
character, two grids, and no row is ever parsed as both.

Each army is laid from its own edge, and the second is placed by a **180°
rotation about the board's centre** — not a copy, which would run both lines the
same way down the board. Facing is toward the enemy: north for the first player,
south for the second. Unit ids are `${colour}-${n}` in **army scan order**, row
then column, **within that player's own army** — so each side numbers from 1
whatever the other fields — and are deterministic because `initial_state` plus
the log must replay identically.

**A board too small for the zones is refused, not clamped.** ⚠️ A negative
centring margin would deploy units at negative coordinates — a state that
parses, stores and replays while being wrong from the first frame. The depth
check sums the zones rather than doubling one.

**What a map owes a player is a zone they can fill.** `wheels` cannot enter river
or mountain at any price, so a board that draws either inside a zone strands
whatever gun is put there. ⚠️ **`maps.test.ts` checks every square of both
zones, for every movement type the terrain table prices** — not the squares one
army happens to occupy. That is the stronger property, and it caught a pond
inside a zone on `lakeland` that the army-based check could not see.

⚠️ **Map ids are immutable.** A match records the id it was built from, so
changing a map's terrain under its id retroactively changes what every existing
match claims to have been played on. A changed map gets a new id.

`getMap` throws on an unknown id, and **`rows[0]` is the row nearest the
camera** — row index increases north, so a map written out top-down is upside
down in the source.

**Every map is 12×12.** Nothing in the code requires it — `createMatchState`
centres the zone on whatever width it is handed — but `maps.test.ts` asserts it,
so it is a constraint rather than a coincidence. The zone spans ten columns,
leaving one spare a side.

| | |
|---|---|
| `classic` | A river across the middle with one bridge, woods on the near approach and high ground on the far one. Infantry ford anywhere; cavalry and artillery must take the crossing, which is the whole board |
| `crossroads` | A road network closed into a figure of eight. No water and no high ground, so nothing is impassable and cost is the only thing shaping a move — which makes it the board artillery likes |
| `two-bridges` | One river bent through a right angle with a crossing on each arm. ⚠️ The only board carrying **both deck orientations**, so it is the only one that exercises all of `bridgeTurns` |
| `lakeland` | A lake ringing an island, plus a pond clear of both deployment zones. The island is where the water's *price* shows: infantry wades across in one turn, cavalry needs two and spends the night between them in open water at zero defence, and artillery never arrives at all |
| `meadow` | Open field, a **lateral** road straight across and one rise in the middle. A road across rather than along helps you redeploy along your own line more than it helps you advance |
| `common` | Open field with the opposite road — up the middle, the fast way *at* the enemy — and hills on both flanks: 4 stars of cover apiece and shut to wheels, so a strong position no gun can ever hold |

⚠️ **A river may only leave the board where a deployment zone is not.** The
zones are the middle ten columns of the two rows at each end, and `wheels` cannot
enter water or rock, so neither may be drawn there. `two-bridges` shows it: its
north–south arm stops one row short of the edge. ⚠️ This is now **checked rather
than kept by hand** — see `maps.test.ts` above.

`StartScreen` picks between them and `POST /api/matches` carries the choice;
omitting it takes `DEFAULT_MAP_ID`.

The test fixture `makeState` accepts either map rows or a size, and a size
generates a plains character map and parses that.

## Movement

```ts
exploreMovement(state, unit, movementRange, movementType) → Movement
  .reachable                   // Coordinate[] — where the unit may stop
  .settled                     // Coordinate[] — everything the search touched
  .pathTo(destination)         // Coordinate[] | null — cheapest route
```

The budget and movement type are arguments; callers resolve them from
`getUnitType`. The search relaxes over a FIFO queue: a neighbour already
recorded more expensively is lowered and re-queued.

⚠️ **The four touching tiles come from `orthogonalNeighbours` in
`coordinate.ts`**, which is the same argument `tileDistance` makes in its own
comment: written inline at each caller, it is that many chances to disagree
about a diagonal. It was inline three times — this search, the client's facing
choices, and the terrain tiler's flood fill — and one of the three was spelled
`neighborsOf`, the only American spelling in the codebase, so a grep for the
others missed it. ⚠️ It is **unclipped**: the search rejects a tile by cost and
the panel by the board's edge, so folding either filter in would make the other
pass bounds it has no use for. The tiler's `neighbourMask` still writes its four
out longhand, because there the order *is* the meaning — they pack into bits
`N=1, E=2, S=4, W=8`.

`reachable` and `settled` are different sets, and they answer different
questions. A friendly unit's tile is settled and walkable-through but is not a
destination, so `pathTo` answers for a larger set than `reachable` lists. The
unit's own tile stays in the map — every path chain terminates there — and
`pathTo(unit.position)` is `[position]`.

**`settled` is what the range overlay draws; `reachable` is what decides a
click.** Not everything lit is clickable: the overlay answers *how far can I
go*, `handleTileClick` answers *may I stop here*, and a click on a friend
selects it instead.

`settled` is **exactly** the set `pathTo` answers for, and a test says so.

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

## Combat

`shared/src/combat.ts` holds the rules of both attacks and no state:

```ts
refuseAttack(state, attacker, path, targetUnitId) → string | null
refuseCharge(state, attacker, path, targetUnitId) → string | null
tilesInRange(unit, from, gridWidth, gridHeight)   → Coordinate[]
wouldCounter(defender, from)                      → boolean
chargeThreshold(attackerType, defenderType)       → number | null   // null = cannot charge
chargeChance(state, attacker, defender)           → number | null
resolveBattle(state, attacker, defender, rolls)   → BattleResolvedEvent   // fire
resolveCharge(state, attacker, defender, rolls)   → BattleResolvedEvent   // charge
computeDamage(state, attacker, defender, roll)    → number
```

One private `outsideRange` answers which side of the band a distance falls off,
and both callers use it: `refuseAttack` turns it into a reason, `wouldCounter`
asks whether there is one.

**A counter fires iff the defender survived, is not `slow`, has the attacker
inside its own range, and was not shot from directly behind.** One predicate,
no unit categories.

⚠️ **The `slow` conjunct subsumes the band's lower end**, so the band's *too
close* case is not observable through `wouldCounter`: artillery is the only unit
with `min > 1`, and it is slow. `refuseAttack` reads both ends, and is where
that half is tested.

### Slow

```ts
slow: boolean   // artillery, and nothing else
```

A slow unit may move **or** attack in a turn, never both, and never answers a
shot. The two rules are enforced in different places, because they are asked at
different moments:

- `wouldCounter` returns false outright, before the band and before facing. A
  slow defender never answers, at any distance, from any side.
- `refuseAttack` and `refuseCharge` refuse when the unit has **moved**, which is
  `path.length > 1`. Turning in place is a single-element path and so is not
  moving: a gun may pivot onto a target and fire in one action.

Both refusals take the whole `path` rather than the destination, because where a
unit ends up does not say whether it travelled.

Moving alone is legal. The flag forbids the pair, not the movement.

### Facing

**Facing does exactly three things**: a shot from directly behind goes
unanswered, a shot on the flank cuts the counter to `FLANK_COUNTER_SHARE`, and
it adjusts a charge's threshold. `computeDamage` cannot see facing at all, so
there is no modifier on the *outgoing* shot — position limits the reply, it does
not sharpen the blow.

A single-element path is a **turn in place** — legal at cost 0, and a real
defensive action.

### A shot from behind is never answered, and a flanking one is answered softly

Where facing changes shooting. Position affects *the reply* — who may answer and
how hard — never what the attacking shot does.

⚠️ **Only the negation is visible before committing.** `attackForecast` reports
*they return fire* or nothing, so a reduced counter reads the same as a full one
at the moment of choosing; the cutaway prints both sides' damage afterwards, so
the flank rule is learned in play. ⚠️ **The scaling is applied after luck**,
which narrows the luck band on a flanked counter from 0–9 to 0–6 and destroys
the roll's recoverability from the log — see `rollLuck`.

`wouldCounter` takes no facing argument: a `Unit` carries its own, so both
callers — `resolveBattle` and the client's `attackForecast` — get the rule
without passing anything.

It negates the counter rather than shrinking it, and only where a counter was
possible at all.

`coordinate.ts` classifies:

```ts
attackSide(defenderFacing, defenderAt, attackerAt) → 'front' | 'flank' | 'rear'
```

⚠️ **`attackerAt` is measured *from* the defender.** The direction from a unit
to its attacker equalling its facing means it is *looking at* the shot, which is
`front`. Read as the direction the shot travels, every case inverts and no
individual result looks wrong. Diagonals inherit `facingToward`'s tie-break.

⚠️ **`flank` is returned and read by nothing.** Only `rear` is wired for
shooting; charge reads all three. There is no flanking damage bonus.

⚠️ **The test fixture's `facing` is a rule input.** `makeState` defaults units
to `south`, which decides whether a counter happens, so anything asserting one
states the defender's facing rather than inheriting it.

**`hasActed` is not consulted.** Answering an attack is not acting, so a spent
unit still counters. **A charge never asks the counter rule at all.**

`tilesInRange` lives in `shared` so the band is stated once, and the client
paints its overlay from it.

**The client previews the same formula.** `attackForecast` runs `computeDamage`
at roll 0 and at `LUCK_MAX`, which is an **exact range**: luck is added last and
flat, so those are the true floor and ceiling. The counter's *magnitude* is
absent — it is computed on the defender's post-damage health, so it depends on
how the attack roll lands. `answered` is read at the **worst** roll, so it means
*they will fire back unless you kill them*.

The client is told the shape of the outcome and never the roll.

`Rolls` is `FireRolls | ChargeRolls` — named members rather than a tuple. A shot
draws `{ attack, counter }`; a charge draws `{ charge }` alone. ⚠️ **Both of a
shot's are drawn whether or not both are used**, so the number of draws never
depends on the rules.

⚠️ **`from` is where the attacker *ends up*, not where it stands.** A command is
move-then-attack. `validateMove` passes the last tile of the path.

⚠️ **`resolveBattle` is given the attacker as it is *after* moving**, because a
counter-attack reads the *attacker's* terrain, which is the destination's.

All three are pure and take the roll as an **input**.

```
band(hp) = ceil(hp / 10)                    // 1..10, never 0 while alive
damage   = floor(floor(base × band(attackerHP) / 10)
                 × (100 − stars × band(defenderHP) × TERRAIN_WEIGHT) / 100)
           + luck                           // last, flat, unscaled
```

**Health is stored and shown 0–100.**

⚠️ **Both health terms in the formula read the ten-point band, never the raw
value.** Feeding raw health in makes a unit on one point attack at 1% instead of
10%, and the floors swallow it entirely — there is no minimum-damage rule, and
the banding is what stands in for one. The cost: a unit at 91 health and one at
100 fight identically.

⚠️ **Luck is added last and flat.** It is therefore worth proportionally *more*
the weaker the attacker is — nine points on a crippled shot of 18 is half again
as much of it. A dead attacker is guarded explicitly, because `band(0)` zeroes
the base but luck would sail past it and land 9.

⚠️ **No clamp stops cover exceeding 100%, and two constants are what guarantee
it never does.** The bound is `maxStars × TERRAIN_WEIGHT < 10` — at 4 stars and
1.5 the worst case is 60 — and past that line terrain would heal the unit
standing on it. A second, tighter ceiling sits at 1.667, where the weakest
matchup on a mountain rounds to zero and the *no living attacker is harmless*
sweep in `combat.test.ts` fires. Both are tested rather than merely written
down.

Three behaviours fall out rather than being rules: a wounded attacker hits
softer, a wounded defender loses its cover (the terrain term scales by *defender*
band, so damaged units cannot turtle on a peak), and striking first compounds.

The counter is `computeDamage` called a second time in the other direction, on
the defender's *post-damage* health. **The attacker's blow lands even when the
reply kills it.**

**One battle is one event.** `battleResolved` carries both resulting healths,
the `kind`, and `answered`.

⚠️ **There is no `unitDied` and no `died` flag.** *A unit at zero health leaves
the board* is stated once, in `applyEvents`, and that reducer's filter is
broader than "whoever this event killed" — which is what keeps applying the
event twice a no-op.

`answered` is carried rather than derived: reconstructing it means re-running
the counter predicate against a rebuilt state.

⚠️ **The event union is exhaustively checked.** `applyEvents`' default branch
assigns to `never` before throwing, so a new member is a **compile error** until
it is handled. The throw stays, because events arrive as JSON.

**Randomness lives in `server/match.ts`**, in `rollLuck` — the only
`Math.random()` in the codebase. No seed is stored: events carry resulting
values rather than inputs. No `rolls` column either — luck is added last and
flat, so a roll is recoverable as
`actualDamage − computeDamage(preState, …, 0)`.

### Charge

A second attack, chosen instead of firing and spending the turn either way.

```
threshold = floor(CHARGE_THRESHOLD[attacker][defender] × directional)
floor_    = (head-on ? FRONTAL_FLOOR : 0) + terrainDefense × FLOOR_PER_STAR
margin    = max(floor_, targetHealth − threshold)
chance    = max(1, round(100 × 0.5 ^ (margin / CHARGE_HALF_LIFE)))
success = roll < chance                                    // roll is 0..99
repel   = CHARGE_REPEL[defender] + floor((roll − chance) / REPEL_DIVISOR)
```

⚠️ **Capability is a missing row, not a flag.** `CHARGE_THRESHOLD` is a
`Partial` and artillery has none, which is the only place *artillery cannot
charge* is stated. Any unit is still a valid **target**.

**Terrain and a braced front set a floor under the margin rather than adding
to it**, which makes them a *ceiling on the odds* — `0.5 ^ (floor / half-life)`.
Both therefore matter exactly where a charge was about to become a sure thing,
and not at all to one that was already a long shot. Head-on caps at 87% on open
ground and 50% on a peak; **100% needs position *and* open ground**.

⚠️ **The floor is shared across the sides, so cover compresses position.** As
it rises the gap between a head-on charge and one from behind closes on its
own — 87% against 100% in the open, 50% against 57% on a mountain. *Taking
cover protects your flanks* is the same constant as *cover is hard to charge*.

⚠️ **A charge is therefore never free.** A repel is exacted only when a charge
*fails*, so a certain one was a guaranteed kill at no cost. Head-on no longer
has that, from any position.

**The 1% floor is stated rather than emergent**, so integer rounding cannot
produce a silent 0%. It also makes `chance` safe to divide by. At `chance = 100`
there are no failing rolls, since `roll ∈ [0, 99]`.

**Two tables: the threshold says how *likely* a charge is, the repel says what
*failing* costs.** `CHARGE_REPEL` is keyed by the defender alone.

**Repel is flat plus a small term, never a multiplier** — the same shape
`computeDamage` uses for luck, so a near miss costs the base and a wild charge
costs more.

**A charge never consults the counter rule**, so `answered` means *repelled*.
The repel is the defence, and every defender has one.

**Success is damage to zero, not "it dies"**, so a charge is an ordinary
`battleResolved` with no special case in the reducer.

⚠️ **The displacement is a second `unitMoved`, appended after the battle.** The
defender leaves the board when its health hits zero, so displacing first would
put the attacker on an occupied tile — breaking invariant 9's *makes sense
against the state immediately before it*. It is the only place two `unitMoved`
for one unit appear in one batch. `playEvents` skips a move whose mesh already
stands at the destination, which is true of the previewed approach and false of
the displacement; that asymmetry is what makes it work.

⚠️ **`Rolls` is a union whose member the *command* picks**, not the rules. A
charge draws **once**, on 0..99, since the same number decides success and sizes
the repel. Both resolvers throw on a mismatched shape.

⚠️ **`terrainAdmits` is split out of `entryCost` for this.** A successful charge
displaces onto the target's tile, so the attacker must be able to stand there —
and `entryCost` refuses that tile for being *enemy-held*, the one objection a
charge is not troubled by. Sharing the terrain half is what stops movement and
charge disagreeing about what ground a unit may be on.

**The directional factor multiplies the threshold**, so `CHARGE_THRESHOLD` can
be retuned without dragging `FLANK_MULTIPLIER` and `REAR_MULTIPLIER` behind it.

⚠️ **The side is read from where the attacker will be standing.** Both callers
hand over the moved unit — `resolveMove` builds it, and the client's forecast
builds the same one — so a charge is priced by where the ride *ends*.

⚠️ **This is `attackSide`'s second reader and the first to consult `flank`**; the
rear-fire rule uses only its `rear` case.

⚠️ **A multiplied threshold can exceed 100, and the charge is then automatic at
any health** — a dead dial rather than a signature moment, because the rear
distinction stops doing anything. The hard constraint is therefore
`threshold × REAR_MULTIPLIER < MAX_HEALTH`, which at 2 means every entry under
50; the artillery column is the only one that was ever near it.

⚠️ **That guards the full-health case only, and a saturation band survives on
the flank.** `floor(45 × 1.5)` is 67, so a flank charge on a battery is
automatic at 67 health and below on open ground. Accepted: at that health the
gun crew has been worked down, and riding round it should decide the matter. A
base value that reads reasonable head-on can saturate at the flank while the
head-on column looks fine, which is why `scripts/charges.ts` prints all three
approaches on every depth of cover.

### The combat cutaway

Two staged close-ups drawn over the board while a battle resolves, with a DOM
readout printed under them. `render/cutaway.ts` owns the staging;
`playEvents` plays it as its own branch on `battleResolved`.

⚠️ **Two views, not one framed pair.** Two units five tiles apart do not belong
in one space, and every attempt to stage them together becomes a compromise
about distance. Each combatant gets its own camera looking at its own patch, so
nothing has to frame a pair.

⚠️ **A second camera — not a second scene, and not the board's camera moved.** A
second scene would load every unit model again, `loadUnitModels` binding its
container to one scene. Moving the board's camera would fight its locked radius,
its clamped tilt and `holdTheBoard` re-clamping the target every frame, then have
to restore all three. ⚠️ **And the board's camera never gets a viewport**:
`holdTheBoard` sizes its ortho extents from the *canvas* aspect every frame, so a
viewport would leave the board fitted to a shape nobody is drawing. The staged
cameras draw over the full-canvas board instead.

⚠️ **The tile is a representation, not a window onto the board.** It says *this
unit is in forest*, so it needs no neighbours and no road continuation.
`createTerrainMesh` takes a cells array, so one tile is the same call with a
smaller argument — props included, so a wood arrives with its own trees. The cell
is the board's own, taken from `composeTerrain`'s result.

**The figure is framed from its own bounding box**, via
`getHierarchyBoundingVectors`, so it survives a new model or a changed
`PIECE_SCALE`. The readout's strip is reserved in the **camera** rather than by
layout.

**A backdrop plane**, in the scene rather than in DOM, because the models are
drawn by Babylon and anything behind them has to be too.

**Built on show and torn down on hide.** The models come from already-loaded
containers, so instantiating two is a call rather than a load.

**The readout is DOM.** A full bar at the true health with the number beside it,
not the board's ten bands, with the band lines drawn over it. ⚠️ It carries a
battle **id** so each side remounts rather than correcting itself in an effect.

**It ends on a click, not a timer.** ⚠️ The click comes from the **overlay**,
which covers the canvas and swallows pointer events — a click during a cutaway
would otherwise be read against state the board is not yet showing — so Babylon
never sees one while a cutaway is open. `dismissCutaway` is a no-op when nothing
is waiting.

## Victory

`shared/src/victory.ts`:

```ts
soleSurvivor(state) → PlayerId | null    // who has won, by elimination
isOver(state)       → boolean            // whether the marker is set
```

Elimination is the only condition: **a player with no units has lost**.

⚠️ **`soleSurvivor` reads the roster; `isOver` reads the marker.** A board can
satisfy the condition before any resolution has recorded it, and that gap is
where `resolveAction` asks.

`soleSurvivor` is the N-player predicate, not "the one who isn't the loser". An
empty board answers `null`. At most one player is eliminated per resolution,
because `wouldCounter` is false at zero health, so a single battle kills exactly
one unit.

⚠️ **`resolveAction` folds to ask.** Units leave the board in `applyEvents`, so
the question cannot be answered from `state`, which predates the death. It is
the only fold in resolution. `endTurn` does not ask, because ending a turn
removes no units.

⚠️ **`gameEnded` is emitted alone, never with `turnEnded`** — an early return
guarantees it, so the loser's `hasActed` flags are not refreshed for a turn that
never comes.

### What each surface does with it

⚠️ **One guard, in `submitCommand`, covering all three callers** — End Turn, an
attack and a move inherit the same answer to "may I still play", rather than
each relying on its own button being `disabled`.

⚠️ **`clickTile` keeps a guard of its own.** Selecting a unit, drawing a route
and walking a preview submit nothing, so `submitCommand` never sees them. It
reads the **live** state rather than the rendered copy.

Neither is the rule — `validateCommand` is what refuses. These stop the round
trip and the rejection banner.

⚠️ **The status bar asks `isOver`, not whether the winner resolved to a player.**
Asking `isOver` first also keeps `getCurrentPlayer` out of a terminal render,
which matters because it *throws* when `currentTurn` names nobody and runs every
frame. End Turn is disabled off the same answer.

⚠️ **In the lobby the winner *displaces* the turn rather than joining it.** A
finished row showing both would read *player-blue · player-red won* — true, since
it is still whose turn it would have been, and useless. The board resolves the id
to a display name; the lobby shows the id, having no roster to resolve against.

## HTTP

Plain request/response over `Bun.serve`'s own `routes` table. No SSE, no
WebSockets, no server push. Everything is same-origin in dev and production
alike; the client calls `/api/*` relative.

```
GET  /api/maps                        → MapSummary[]
GET  /api/maps/:id/preview            → MapPreview               (stores nothing)
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
reason in the body. ⚠️ **An unknown map id is a 404 at `preview` and a 400 at
create**, which is a distinction rather than a slip: asking to look at a board
that does not exist is a missing resource, asking to *build* on one is a bad
argument. `findMap` is `getMap` without the throw and serves both. Every non-2xx body this code writes is an `ErrorResponse`;
the one exception is bun's own 413 from `maxRequestBodySize`, which it answers
before a handler runs.

`state` is present on an events response only when `seq` advanced past the
requested `since`. A caught-up poll answers `{ seq, events: [] }` and skips the
log query.

**Payload limits:** `maxRequestBodySize` is 64 KB; `MAX_PATH_STEPS` in
`parseCommand` is 256. `parseCommand` validates shape and field types at
runtime and rebuilds a fresh object, so extra properties are dropped.

**Session:** `withSession` wraps every route entry and mints an opaque id into a
`wargame_session` cookie — `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` one
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
              current_seq, current_turn, map_id, winner, PRIMARY KEY (id))
resolutions  (match_id, seq, actor, action JSON, events JSON, created_at,
              PRIMARY KEY (match_id, seq),
              FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE)
```

`initial_state` is written and never read. `current_state` is a checkpoint;
events are authoritative. `current_turn` is denormalised so listing matches
parses no boards. `map_id` is read only to label a match in the list — replay
never needs it, because `initial_state` already holds the instantiated board.
`action` is written and never read.

`winner` is denormalised for the same reason as `current_turn`, and is
**nullable** where `map_id` took a default: null means *still being played*. It
is written on **every** submit rather than only when it changes.

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
`RejectedError` is a separate type for a 422. Also holds `api`, the endpoints
that are **not** scoped to a single match, which is why they are not on
`GameServer`.

**`net/gameServer.ts`** — `connectGameServer(matchId, { onConnectionChange? })`
returns `{ ok: true, server } | { ok: false, kind, reason }`.
`onConnectionChange` reports a `ConnectionStatus` of `'connected' | 'retrying'`,
which surfaces as a reconnecting banner. It fetches initial state
before returning, so `getState()` is synchronous. Polling every 2s, doubling to
30s on failure and resetting on success; a hidden tab polls at the slowest
interval and a `visibilitychange` listener resets and polls immediately on
return. Updates are deduplicated by `seq` before reaching any listener.
`dispose()` stops the loop, clears listeners, and removes the listener.

**`routes/`** — `/` is `StartScreen` (list, and create on a chosen map; the
picker does not appear if `GET /api/maps` fails, and creating then takes the
server's default); `/maps` is `MapViewer`; `/:matchId` is
`MatchRoute`, which is keyed on the id so a param change remounts the
connection. It owns the async connect, renders `GameCanvas` only once a server
is ready, and disposes on unmount including a connection that resolves after
teardown. A failure renders one of two things, which is what `FailureKind` is
for: `notFound` offers a link back and no retry, `unreachable` offers a working
Retry that re-runs the connect.

⚠️ **`/maps` ranks above `/:matchId` whatever the order they are written in** —
react-router scores a static segment above a dynamic one — so a match whose id
were literally `maps` would be unreachable. Ids are uuids, so that is a
curiosity rather than a bug.

### The map viewer

`MapViewer` is a picker over `GET /api/maps` and **the game's own renderer**
built on `GET /api/maps/:id/preview`. ⚠️ **It draws a whole `GameState`, not a
terrain grid**, which is why the endpoint returns one: a second way to draw a
board would be a second thing to keep in step with `composeTerrain`, and it
would be the copy nobody notices has gone stale. Showing the deployment is the
point rather than the price — a deployment square drawn onto a river is a
property of the *pair*, which is the same reason `maps.test.ts` asserts against
`createMatchState` rather than against rows.

**Nothing is wired for input**: `onTileClick` is never registered, so the canvas
orbits and zooms and answers nothing else. That is the whole difference from
`GameCanvas`.

⚠️ **One effect does the fetch *and* the build**, so a single `disposed` flag
covers both halves of one attempt. Split in two — state into `useState`, a
second effect watching it — a map switched twice in flight can resolve out of
order and leave the scene showing the first answer.

⚠️ **The canvas is keyed on the map id**, so each scene gets a fresh element.
Babylon takes the canvas's WebGL context at construction and gives it back on
`dispose`; building a second engine on the same element asks for a context that
has just been handed back, which is a black canvas on some drivers and fine on
others.

**The viewport is roughly square.** `holdTheBoard` sizes the frustum from the
board's ground-plane *half-diagonal* — the worst case over every camera angle —
so a wide box spends the surplus on background, and boards are square.

**`game/useGameSession.ts`** — the session: render replica, rejection state,
in-flight guard, selection, and submits. Takes `onEvents` and `onSnap` callbacks
held in a latest-ref, so the subscription depends on `server` alone.

Selection is React state and is **returned** rather than pushed through a
callback, so it has one copy: whoever renders it and whoever reads it to compute
the next click see the same value. `pendingRef` stays a ref — it is a mutex
against a second submit landing before the first resolves, and has to be
synchronously current rather than rendered.

`clickTile`, `chooseAction` and `endTurn` are the verbs. The panel's buttons are
the only thing in the game that is not a tile.

Otherwise a plan is pinned, confirmed *and* abandoned by a click on the board —
whatever is lit does something and everything else is the way out. A refused
submit rolls back to the unit **selected**, not to the destination the server
just refused.

⚠️ **Confirming a pinned route** — a second click on the tile it already ends at
— starts a **preview walk**: the unit moves on screen while nothing has been
sent. `onPreview(next | null)` drives it. There is no commit verb: a confirm and
an incoming update both end with `onSnap` writing an authoritative position over
the mesh. It *is* called on a rejection, the one ending that produces no update.

⚠️ `walking` is true until the preview settles, and **nothing is answerable
during it** — `playEvents` skips a move only once its mesh stands at the
destination, so committing early would replay the committed move from halfway
along the path. `clickTile` closes over `walking` rather than reading it from a
render that may predate the walk, and the guard sits at the top rather than
inside a phase, because a poll can unpin a plan mid-walk.

Every update runs through a serial promise queue:

```
on update (events, state):
  clear the rejection                       -- immediately, on arrival
  enqueue:
    if worthAnimating(events): await onEvents(events)
    onSnap(state)
    commit state
```

⚠️ **An uncommitted plan does not survive that commit** — either kind, pinned or
arrived, is dropped back to the unit selected, because the board it was drawn
against has moved. This is the first thing to suspect when a pin seems to vanish
on its own.

`worthAnimating` is false for an empty batch, while the tab is hidden, and for
a batch of more than **four events**.

⚠️ **A backlog gate, not a duration one**, which is why a plain count suffices.
One action produces at most four events — approach, battle, displacement,
turn-end — so a turn always animates. It fires only when several resolutions
arrive together, which means the client was away.

A new event type needs no entry anywhere. Long and short moves are alike.

A failing animation or snap is caught and logged; the commit always happens.

**`game/interaction/selection.ts`** — pure: no React, no server.

```ts
handleTileClick(state, selection, coordinate) → SelectionState
destinationOf(pinned)                         → Coordinate
confirmRoute(routePinned)                     → DestinationChosen
enterMode(state, arrived, kind)               → DestinationChosen   // a mode's tiles
readAimClick(state, attacking, coordinate)    → Unit | null        // fire or charge
readHoldClick(state, arrived, coordinate)     → Facing | null
chooseTarget(attacking, target)               → TargetPinned
clearStep(arrived)                            → DestinationChosen   // back to the panel
unpinDestination(pinned)                      → SelectionState      // back to the board
moveCommandFor(arrived, facing)               → Command
```

⚠️ `enterMode` is the *only* thing a button reaches (through the hook's
`chooseAction`); everything else a player
does is a tile click. `clearStep` and `unpinDestination` are the two back-out
rules, one per level.

⚠️ **`canFire` decides whether the panel offers Fire at all, and it asks
`refuseAttack`** — the server's own rule — rather than counting what stands in
`tilesInRange`. The band is *reach*: it knows nothing about ownership, a minimum
range, or a unit targeting itself, so a panel built on it would offer Fire for a
friend two tiles off and the click would then be refused. One rule asked twice
cannot disagree with itself — and it is what makes `slow` free on the client:
Fire simply stops being offered to a gun that has already moved, because the
refusal it asks reads the path. It walks every unit rather than the band, which is
sixteen against up to sixty and needs no grid bounds. ⚠️ **Unavailable actions
are omitted, not greyed**, following AW — the cost is that *nothing in range* and
*I misread the menu* look alike, and the menu changes height between units.

`destinationOf` answers *where the unit is standing* — which is also the tile a
second click must land on to commit, and the tile the facing choices are drawn
around.

⚠️ `pinned` above is **any** phase carrying a path; `arrived` is only those that
have walked. `unpinDestination` is the sole helper serving both, because
backing out means the same thing in both modes and nothing else does.

`handleTileClick` **never produces a command** — it picks a destination and
nothing more. The phase dispatch that decides whether a click commits lives in
`clickTile` above it.

```ts
| { phase: 'idle' }
| { phase: 'unitSelected'; unitId; position; movement }
| { phase: 'routePinned'; unitId; path; movement }
| { phase: 'destinationChosen'; unitId; path; movement; step }

MenuStep
  | { kind: 'choosing' }                     // panel up, nothing lit
  | { kind: 'firing'; tiles; target | null }   // the band; null until one is pinned
  | { kind: 'charging'; tiles; target | null } // the neighbours it may charge
  | { kind: 'holding'; tiles }                 // the four beside it
```

`movement` is the whole `exploreMovement` result, snapshotted at selection time.
`reachable` decides whether a click pins; `pathTo` builds the path.

⚠️ **Each mode carries the tiles it lights**, built when the mode is entered.
`showSelection` is therefore a *pure projection of the selection* and needs no
game state to know what to paint. The tiles cannot go stale, because any board
change discards the plan. Which tiles those are is decided in `selection.ts`,
including the board-edge clipping; the renderer colours lists.

⚠️ **`Pinned` is `Extract`ed on carrying a path**, not hand-written as a union
of phase names, so a phase with a path joins it by existing.

⚠️ **`isPlan`'s runtime list is pinned to the type from both directions.**
`satisfies readonly Pinned['phase'][]` rejects a name that is not a phase; a
`never` assertion beside it rejects a phase left *out*, which `satisfies` cannot
see. Same trick `applyEvents` uses on its event union.

**Four phases, and the menu's steps are a field rather than more of them.**
`unitSelected` and `routePinned` both light the range and answer clicks
identically, which is why pinning and re-pinning are one code path.
`destinationChosen` is everything after the walk, with `step` saying which
question is being asked.

#### The panel picks the intent

**There is no single click reader.** `readAimClick` answers *is this an enemy I
may attack, by the rule of the mode I am in*; `readHoldClick` answers *which way
is this*; neither can be asked in the other's mode, so the collision is
unrepresentable. The two attack modes share one reader, differing only in which
refusal they ask — `refuseAttack` or `refuseCharge`.

**Buttons pick intent; tiles pick targets.** A target pins and confirms exactly
like a route: first click pins it and shows the forecast, second commits, a
click on a different lit enemy re-pins. The forecast panel is *informational*
and carries no button.

⚠️ **Two rules for backing out, not a chain.** A dark click inside a mode returns
to the panel; a dark click at the panel un-walks the ghost and returns to movement
selection. "Lit does something, dark backs out" reads because at most one set is
ever lit.

⚠️ **Exactly one overlay is lit, and `setStepTiles` is what guarantees it** —
one call taking the lit overlay, so the invariant is in the signature. It is
named for what it paints — `attack`, `charge`, `facing` — rather than for what
the player is doing, which keeps `render/` from importing the interaction layer
to name a colour. `STEP_UI` in `GameCanvas` maps between the two vocabularies
and carries the hint line with it.

The attack band is unfiltered: facing is its own mode, so reach is simply
reach.

**The forecast reads through the step.** `attackForecast` and `facingForTarget`
take a `TargetPinned` — an attack mode with a target pinned — which
`isAttacking` and `isTargetPinned` narrow to. ⚠️ These were `Aim` and `Aiming`,
which read the wrong way round: the gerund sounds like the earlier state and was
the later one, across four symbols separated by three letters. ⚠️ Two predicates, so no caller spells the two-level check
by hand; that is what absorbing `targetChosen` costs, paid once.

⚠️ **`Attacking` covers firing and charging together**, because everything between
picking a mode and committing is identical: the same pin-then-confirm gesture,
the same re-pin, the same second click. The kind is read off `step.kind` at the
single place that builds the command, rather than branched on through the
dispatch.

⚠️ **`Forecast` is a union, because the two attacks are knowable to different
degrees.** A shot's damage is a *range* — luck is added last and the roll is
unknown. A charge's odds are **exact**, `chance` being a pure function of state
with no roll in it, and it is the *repel* that comes as a band. Flattening both
into one shape would force the charge to present its certainty as an estimate.
⚠️ That band narrows on its own as the odds improve — a likely charge leaves a
narrow window to fail into — which falls out of `99 − chance` rather than a rule.

**The charge overlay lights targets, not reach** — the opposite of the shooting
band, because a charge is contact-only and has no reach to show.

`canCharge` is `canFire`'s twin and asks `refuseCharge`, the rule the click will
ask, so the menu row and the board cannot disagree. Artillery has no threshold
row, so the rule refuses every target and the row never appears.

**`availableActions` is the one list both the panel and the skip read.** Holding
is always last and always present, so the list is never empty — which makes *one
action* mean **nothing to attack** rather than nothing at all.

⚠️ **It reads a table pinned to `ActionKind` from both directions.**
`PANEL_ACTIONS` pairs each kind with the predicate that offers it; `satisfies`
checks every entry names a real kind, and a `never`-assertion fails the build
when a kind has no entry — the same guard `PINNED_PHASES` carries. Holding's
predicate is a constant `true`, so *always available* is a fact in the table.

**A one-row panel is skipped, in both directions** — on the way in, and on the
way out, since its single row is the mode just left.

Either pinned phase is a **plan, not a submission** — nothing has been sent, and
a click that means nothing else discards it without the server hearing. `path[0]`
is where the unit still stands, so unpinning needs no extra field, and the
selected unit's own tile is a destination like any other: acting without moving
needs no gesture of its own. ⚠️ Which means clicking the unit **pins standing
still** rather than deselecting.

⚠️ In `destinationChosen` — and only there — `handleTileClick` returns the
**same object** it was given, so a click already read as a direction causes no
re-render. `routePinned` is excluded, because its clicks are tile clicks.

**In the holding step the tiles around the unit are the menu**: a click on the
destination keeps the direction travelled (`holdFacing`), a click on one of the
four beside it overrides that (`facingChoiceAt`), and **either commits**.
Anything further away is ignored.

⚠️ The two answers cannot collide: `facingChoiceAt` returns `null` for the
destination itself, because `directionBetween` wants a step of exactly one tile.
`holdFacing` is the only one that needs `GameState`, for the case with no last
step to read. The renderer clips the four to the board.

**`game/GameCanvas.tsx`** — the canvas ref, the renderer lifecycle, and the
chrome around it: the turn label, End Turn, the rejection reason, the
reconnecting banner, and a Toggle Inspector button under an
`import.meta.env.DEV` guard, plus a hint line during action selection. End
Turn is disabled while *either* kind of plan is open, since ending the turn
there would submit around one the player has not answered for.

The tile menu lights **on arrival** rather than on confirm, so `showSelection`
is a projection of the selection *and* `walking`: the range stays lit while the
unit walks and comes down as the menu lights.

⚠️ **The route and the confirm pane are one affordance**, drawn on
`routePinned && !walking` and gone the instant a route is confirmed. That
predicate is why `walking` is a display input and not just a guard.

**The confirm pane is DOM over canvas** — a small box anchored above the pinned
tile, mounted only while it applies. ⚠️ React populates refs during the commit,
*before* effects run, so the anchor effect finds the element on the render that
introduces it and `null` on the one that removes it, which is exactly the clear.
`pointerEvents: none`, because the tile underneath **is** the button and a pane
that swallowed the click would block its own confirmation. Its container clips,
since `Vector3.Project` does not: a tile zoom has pushed off screen would
otherwise position an absolute child outside the viewport and add scrollbars.

The hint line and the pane **hand over rather than overlap**: the pane belongs
to movement selection, the hint to action selection.

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
setRange(tiles)           setRoute(path)
setStepTiles(overlay | null, tiles)   // 'attack' | 'charge' | 'facing'
anchorTo(element | null, coordinate | null)
playEvents(events): Promise<void>
syncUnits(state)          previewMove(unitId, path): Promise<void>
onCutaway(handler)        dismissCutaway()
lastDrawn(): GameState
cancelPreview()           toggleInspector()          dispose()
```

⚠️ **`onCutaway` and `dismissCutaway` are the staged close-up's half of the
seam** — the renderer raises the views and hands the caller what it would
otherwise re-derive, because the readout is text and layout and belongs in the
DOM. See *The combat cutaway*. `dismissCutaway` is a no-op when nothing is
waiting, so a late click from a cutaway that already closed needs no guard.
⚠️ **`lastDrawn` is a record of what was drawn, not a second source of truth.**
`syncUnits` remains the only thing that moves it, and anything wanting authority
reads `server.getState()`.

⚠️ **Coordinates, never a `Movement`.** The renderer is told what to light, not
handed a search to query — presentation gets facts, the rulebook stays upstream.
`setRoute` takes the path *in order*, which a tint does not need but an arrow
would, so that interface survives the rendering changing under it.

`anchorTo` keeps a DOM element sitting over a tile: **the renderer writes its
`transform`** from the render loop while React owns only the content, because an
overlay tracking the board is otherwise a React commit every frame the camera
turns. ⚠️ Projection lands in render-buffer pixels and is scaled to CSS pixels
by the hardware scaling level — equal today only because `adaptToDeviceRatio`
is off.

⚠️ **The element is lifted a tile above the surface, in *world* space**, so the
pane clears the thing it is describing. A pixel margin would drift with zoom; a
world offset is projected like everything else.

⚠️ **Because the renderer writes only `transform`, everything else about a pane
is CSS.** The three anchored panes — menu, forecast, confirm — are
`.board-pane` in `index.css` plus one modifier each, and they read a `--board-*`
token set defined there: surface, edge, lift, ink, hover, damage, track,
radius, clearance.

⚠️ **The board's tokens are separate from the page's, and that is the point.**
These sit on a lit 3D scene rather than on the page, so their contrast is
against grass and stone; wiring them to `--bg` would produce a light-mode panel
that is unreadable over the board. `--danger` and `--warn` *are* page chrome and
live with the page tokens.

**One surface token for all three panes**, one `--board-clearance` for their
offsets, and one `--danger` for the error red across both routes and the canvas.

**Row hover is `:hover`, not React state.** There is no disabled row — an
unavailable action is omitted — so hover is the only state a row has.

- **Camera:** `ArcRotateCamera` in `ORTHOGRAPHIC_CAMERA` mode, starting at a
  fixed isometric angle. Orbit stays on the default input; **wheel zoom does
  not**. An orthographic camera's apparent size comes entirely from its ortho
  bounds, so moving along `radius` changes nothing visible and only walks the
  camera toward the board until the near plane clips it. The wheel input is
  removed, `radius` is pinned by matching limits, and a listener on the canvas
  scales a zoom factor that the ortho bounds divide by — clamped, and removed in
  `dispose()` alongside the `resize` listener.

  ⚠️ **How much room the board needs is settled once, at build, and nothing
  here ever reads the camera.** `boardRadius` is the ground-plane half-diagonal
  and `boardRise` the height either side of the target, both measured off the
  slab's own bounding box so its overhang counts. From those: `reachX` is the
  radius, which no `alpha` exceeds, and `reachY` is taken at
  `CAMERA_BETA_TOPDOWN` — the most overhead tilt allowed, and so the one
  needing the most vertical room. Only the **window** and the **wheel** move the
  extent after that.

  ⚠️ **Nothing in the fit may read the camera**, or the board rescales as it is
  turned: a square board is half-width across down an axis and half-diagonal
  across at 45°, and its depth projects by `cos β`. The price is dead space at
  every angle but the worst one — on a 12×12 the board sits in roughly three
  quarters of the height it could fill looking down an axis.

  Each frame the frustum is sized so `zoom = 1` is *the whole board just fits*,
  which is both the **floor** the wheel cannot go below and the **default** it
  starts at. The target is then clamped per axis to whatever board the viewport
  does not already cover. **Centring is not a rule of its own**: at full zoom-out
  the slack goes to zero and the clamp centres the board.

  Run every frame rather than on a change, since orbit, tilt, zoom and window
  all move independently.

  ⚠️ **Rotation is free; tilt is not.** `alpha` spins without limit, since a
  unit's rear has to be somewhere the player can go and look at. `beta` is
  clamped to **30° to 60° above the horizon, starting at 38.6°**. The shallow end
  is a *legibility* bound rather than a picking one: `screenToTile` searches
  every surface height, so a click stays right however low the camera gets.
- **Tile lookup is math, not mesh-picking**, and the pointer event has to agree
  with that. ⚠️ **The handler listens for `POINTERTAP`, never `POINTERPICK`.**
  Babylon emits `POINTERPICK` only when its ray hits a **pickable mesh**, and the
  terrain sets `isPickable = false` — so `POINTERPICK` delivers a click only
  where some *other* pickable mesh happens to be, with bare ground swallowing the
  rest. `POINTERTAP` fires for any tap that is not a drag.
- Heights: tile lookup is no longer against *one* plane.
  `screenToTile` tries each distinct surface height the board has, **tallest
  first**, and takes the first answer that agrees with itself: the tile found at
  height `h` must be a tile whose surface is at `h`. Tallest first is what lets
  a peak win over the plains it occludes. Cheap, because a board has two or
  three distinct heights. Terrain meshes stay `isPickable = false` and Babylon's
  mesh picking stays out of it. ⚠️ Clicking the *side* of a raised tile agrees
  with nothing, so the flat reading is kept as a fallback.
- **Elevation is visual only; the map data has no height.** A tile's walkable
  surface is `surfaceAt(coordinate)` in `renderer.ts`, the one place any `y` is
  decided — terrain props, units, the walk tween, `syncUnits`, `cancelPreview`,
  every overlay and now picking read it, so a raised tile cannot be raised for
  some of them and not others. Three ways a cell can say how high it is, in
  order of preference:
  - Nothing at all, and `terrainModels.topOf` **measures** the ground model's
    bounding box at load. Derived from the art, so swapping a model moves the
    surface with it. ⚠️ `bottomOf` is its counterpart and answers a genuinely
    different question — how far a tile reaches *down* — which only anything
    positioning itself under the board has any use for.
  - `TerrainCell.standOnProp` — the index of a prop a unit stands **on top of**,
    whose height is likewise measured. A mountain is this: an ordinary grass
    tile with a mesa standing on it.
  - `TerrainCell.standOn` — a *declared* offset, for the one case measurement
    gets wrong: standing **partway up** a prop. A bridge deck is 0.15 on a model
    that reaches 0.35, because its own top is the handrail.
  - ⚠️ **`MAX_STAND_HEIGHT` is 0.5, and it is a legibility limit rather than a
    picking one.** Picking now finds a peak however tall it is. What binds is
    the camera: a surface at height `h` *draws* `h / tan θ` tiles up-screen of
    its own tile — `1.25h` at the starting angle, `1.73h` at the shallow end of
    the band — and past about half a tile it visually occupies its neighbour
    whether or not the click lands right. So the mesa covers 0.60 of the tile
    behind it at rest and 0.83 tilted right down. A voxel spike put this at a
    full tile and tile identity fell apart on sight.
- The models are [Kenney's Nature Kit](https://kenney.nl/assets/nature-kit),
  CC0, as GLB — the loader units already use. What the code relies on, measured
  rather than assumed: ground tiles are **exactly 1×1 in x and z**, which is
  `TILE_SIZE`, so nothing is scaled; they carry no textures, only flat material
  colours; they are multi-mesh **split by material**, and the set shares a
  small palette of them, which is what makes merging by material worth doing;
  and every model hangs under a node translated **−0.05 in y**, so reading the
  position accessors gives heights a uniform 0.05 too high. ⚠️ `bridge_wood` is
  1.04 square rather than 1.00 and so overhangs its tile by 2% a side. That is
  deliberate — a deck rests *on* its banks — and is recorded here so nobody
  later "corrects" it.
- Terrain is built from **glTF models**, one per tile, and then **merged by
  material** — grouping every tile's meshes by material leaves about fourteen
  draw calls for a board, against several hundred as loose copies. ⚠️ That
  number grows with the *palette*, not the board — each genuinely new colour
  costs one, so a doodad painted in a material the board already has is free.
  Merging works because terrain is made once and never moves.
  `terrainModels.ts` loads the set and
  shares one material per name across all of them, which is what makes the
  grouping work. ⚠️ Three families are recoloured, because the kit reuses materials
  across things that must not look alike. A **road** shares `dirt`/`dirtDark`
  with a riverbank and gets grey gravel; a **mesa** shares the same warm orange
  and gets grey stone, keeping its grass cap; and **scenery on grass** would
  otherwise be the exact green of the ground it stands on, so it gets a warmer,
  lighter green. An override supplies a *name* as well as a colour, since the
  name is what merging groups on.
- ⚠️ The loaded PBR materials are **replaced** with flat `StandardMaterial`s
  carrying their albedo. The kit ships `metallicFactor: 1`, and a fully metallic
  surface with no environment map to reflect renders blank white. Flattening
  also puts terrain and units in one lighting model.
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

- **The renderer records the state it last drew**, and `lastDrawn()` reads it
  back. ⚠️ **That is the state *before* whatever `playEvents` is animating**,
  which is the point: the queue awaits `playEvents` and only then calls
  `syncUnits`, so mid-animation the last sync is still the previous turn. A
  damage animation needs the health it counts down *from*, and `battleResolved`
  carries only resulting values (invariant 9), so the before-value exists
  nowhere else. ⚠️ Not a second source of truth — a record of what was drawn,
  advanced only by `syncUnits`, with authority still read from
  `server.getState()`.

  ⚠️ **Measured off the *loaded* mesh, not the file.** The glTF loader flips z on
  its own `__root__`, which leaves a model's bounding box where the raw
  accessors say it is while putting the *relief* on the far side of it — so a
  piece read out of the file faces backwards with its extents looking correct.
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
- **A wood is scattered across the tiles it covers, not tile by tile.**
  `woodlands` flood-fills the forest tiles into four-connected groups — matching
  `neighbourMask` and every other neighbourhood question in the module — and
  `scatterWood` seeds one stream per group from its **scan-order first** tile,
  so the result is identical whatever order the fill walks in.

  Five trees a tile, planted **round robin**: one pass per tree, each visiting
  every tile of the group once, the first pass required so no square comes out
  bare. ⚠️ The visiting order rotates each pass, because whichever tile goes last
  has every neighbour's trunk already down to dodge — a fixed order thins the
  same squares every time.

  ⚠️ The spacing that turns a candidate away is measured **across tile
  boundaries**, which is what makes the group the unit of placement rather than
  the tile. `KEEP_CLEAR` still binds every trunk, because a unit may stand on
  any of those tiles — so each square keeps its hole however the wood is shaped.
- **Six tree shapes**, each turned and scaled. Every one is painted `woodBark`
  and `leafsGreen`, so a denser wood costs no draw call — the kit's pines carry
  two more materials each, which is why none is used. ⚠️ **They are scaled down
  hard, and the pieces set that number rather than the trees**: at model scale a
  wood stands several times higher than the army walking through it.
- **Open ground carries light scenery** — grass tufts, a small bush, the odd
  flower, on about a third of plains tiles. ⚠️ None of it means anything: a tile
  with a flower plays exactly like one without.
- Grid lines are **one flat grid at the board's floor**, mid grey at 7%. A
  mountain raises a *rock*, not its ground, so every tile's floor is the same
  plane. Long spans draw each interior edge once rather than twice, so the alpha
  means what it says.
- **A slab under the board** — `boardBase.ts`, sized to the grid exactly, 0.8
  thick, not pickable and unknown to `surfaceAt`. ⚠️ Plain, and the lighting is why: every face of a
  cliff model is vertical and the only light is hemispheric from above, so
  relief takes one shade the whole way round. The slab is what makes the board
  an object rather than geometry that stops. ⚠️ It hangs off `bottomOf` — the
  **lowest geometry** on the board — where the grid lines take the highest
  *top*. The two ask different questions, and the reason is that **a tile is not
  flat**: a river is a channel cut *down* into its tile, banks at 0.00 and water
  at −0.05, and a road is recessed the same way. A slab placed by `topOf` is
  therefore drawn straight through both, and the board's water and gravel come
  out slab-coloured — which is not a subtle failure but does look like a
  deliberate palette until someone asks where the blue went. A further 0.01 sink
  clears the ground plane, which has no thickness of its own and would otherwise
  depth-fight a coplanar face in bands that move with the camera.
- A highlight follows the pointer, moved from `POINTERMOVE` inside the
  renderer. React never hears about hover. ⚠️ That highlight is **all** hover
  does — a tint, inert on a touchscreen. The route is selection state rather
  than a hover effect, so it survives on a device with no pointer: the second
  click is what supplies the destination.
- **A unit's health is a ring of ten segments at its base** — `healthRing.ts`,
  extinguishing as it weakens and **absent entirely at full strength**, since a
  ring under every untouched unit is noise. ⚠️ **One segment per band, calling the rulebook's own `band`** — the same
  function `computeDamage` reads, so 91 and 100 show the same count *because*
  they fight identically. Segments extinguish rather than dim, since bands are
  discrete.
  ⚠️ **Parented to the unit's node**, so it rides the walk animation for free and
  is disposed with it. It therefore turns with the unit; accepted, since a ring
  is rotationally symmetric and only the segment boundaries move. It also
  inherits `PIECE_SCALE`, which is wanted — that constant makes each piece fill
  its tile, so the ring stays proportionate to its piece.
  ⚠️ Orange-red, deliberately **not** the amber `SELECTED_COLOR`/`FACING_COLOR`
  family, which reads as another selection tint under the piece. One material
  for every ring, cached on the scene by name, so the
  `disposeMaterialAndTextures: false` that protects unit colours protects these
  too.
  ⚠️ **`syncUnits` is its only writer and it never tweens.** The ring is
  persistent state; showing *change* belongs to the cutaway. That keeps it out
  of `playEvents`, where an animation on the ring would be a different target
  from the unit node and would survive `scene.stopAnimation(mesh)`.
- **The pinned route is an arrow, not a tint** — `routeArrow.ts`, a sibling of
  `tileOverlay.ts` that merges per-tile quads into one mesh the same way and
  adds UVs. A tint says *these tiles*; an arrow says *this way, ending here*.
  Four shapes cover every case, because **a path never branches** so no tile
  connects to three neighbours: tail, straight, corner, head. ⚠️ Orientation is
  a **cyclic shift of the four UV corners**, not a per-tile transform, so every
  quad stays axis-aligned and there is still one draw call. The ring order
  `N E S W` is load-bearing — a rotation is `+1` around it, which is what makes
  orientation arithmetic instead of a lookup table, and the four rotations of a
  canonical `{SOUTH, EAST}` bend cover all four bends exactly.
  **A one-tile path draws nothing**, so standing still needs no fifth shape. The
  atlas is strokes drawn into a `DynamicTexture` with canvas 2D at startup — no
  asset file — in white, with the colour on the material's `emissiveColor`.
  ⚠️ Babylon's
  `ICanvasRenderingContext` has no `lineCap`; the default `butt` is wanted
  anyway, since a flush end is what lets one tile's segment meet the next
  without a seam.
- Units are glTF models from `public/models/`, one per unit type, loaded once
  into `AssetContainer`s and instantiated per unit. Each instance is parented to
  a `TransformNode` of ours: the loader's own `__root__` carries the
  right-handed-to-left-handed conversion as a negative scale, and a facing
  rotation set on that node would compose with the flip and turn the unit the
  wrong way. Models face `+Z`, which is north here, so there is no offset.
- One `StandardMaterial` per player colour, looked up by name so the scene is
  the cache. The models arrive untextured and near-white, so colour is the whole
  of a side's identity. Matte like the terrain — specular is zeroed — plus a
  floor of `emissiveColor` (`UNIT_GLOW`): ⚠️ units are mostly vertical and the
  only light is hemispheric from above, so without it their sides fall into
  shadow exactly where the silhouette has to read.
- Model origins are at the base, so a unit's `y` is the surface it stands on
  rather than half its own height — and so scaling a piece grows it upward off
  that surface rather than sinking it through one.
- **A player's colour is one palette, in `render/playerColors.ts`**, read by
  both the board and the cutaway's health bar. Hex is the source and `Color3`
  derives from it, since hex is the form a person edits.
- ⚠️ **Pieces are not at terrain scale, deliberately.** `PIECE_SCALE` in
  `units.ts` is a `Record` per unit type: a unit is a formation rather than a
  man, so no size makes it and a tree both correct, and a piece is sized to read
  on its tile. A table rather than one dial because the models'
  proportions disagree too much for a multiplier to close: infantry and cavalry
  are scaled to a common height, while artillery meets its **footprint** first
  and stays low — which is what lets a gun carriage tell itself apart from the
  other two at a glance. `getHierarchyBoundingVectors` is how the proportions are
  read. ⚠️ Keyed on `UnitTypeId`, so the key is `artillery` while the model file
  is `cannon.gltf` — a mismatch silently scales a mesh by `undefined`.
- Unit meshes are built once at startup; there is no add or remove.
- `playEvents` walks `unitMoved` paths one tween per tile, at
  `FRAMES_PER_TILE` over `FRAME_RATE` in `units.ts` — one dial for every unit's
  pace. Each step turns the mesh before it moves, so a unit walks the
  way it is looking; the turn is snapped rather than tweened.
- `syncUnits` makes the meshes match state: it **removes the dead**, then
  positions *and* orients the living with no tween, stopping any running
  animation first. It **ends any preview** before either — authority overwrites
  every position, so there is no separate commit step, and a live preview holds
  a mesh by id that must not be disposed mid-tween.
  ⚠️ **Removal only, never creation.** Nothing can add a unit to a match — units
  enter state once, in `createMatchState`, before the renderer is built.
  ⚠️ Disposal passes `dispose(false, false)`: every unit of a colour shares one
  material cached on the scene by name, and disposing it with the first casualty
  would leave the rest of that army untextured.
- **The preview** is one nullable `{ unitId, origin, facing, settle }`. The
  record outlives the walk, because a cancel *after* the unit lands still needs
  to know where to put it back. ⚠️ The promise means *the preview settled*,
  including a cancel or a snap ending it early — `stopAnimation` fires no end
  callback, so a promise tied to the tween alone would hang.
- `playEvents` **skips a `unitMoved` whose mesh already stands at the path's
  destination**. A confirmed preview has walked the unit there, and replaying
  would send it back to the second tile and forward again. Positional rather
  than a flag, and sound because the menu only opens once the walk has arrived.
- `setUnitFacing` is the only writer of `rotation.y`.
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
| `DATABASE_URL` | `file:./packages/server/wargame.db` locally, a `libsql://…` URL on Turso |

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

- React components are tested with the renderer mocked, so Babylon never loads.
  What the suites cover is chrome, lifecycle, and what each interaction
  *projects* — never pixels. ⚠️ **Disposal is tested wherever a renderer or a
  connection is built**, including one that finishes arriving *after* teardown,
  because that is the failure which leaks in silence: an undisposed scene holds
  a WebGL context and a render loop, and nothing on screen looks any different
  for several of them.

- **`routeArrow.pieceFor` is tested** as the only part of that module that
  *decides* anything: a wrong rotation on one of the four bends stays invisible
  until somebody routes that way.
- `composeTerrain` is the one piece of the renderer that is pure, and it is
  tested like any other pure module — including that no cell declares a
  `standOn` above `MAX_STAND_HEIGHT`. The other half of that ceiling is how tall
  a *model* measures, which nothing can know without loading it, so
  `warnIfTooTall` checks the whole surface at startup instead. ⚠️ An asset test would need
  `node:fs`, and `client/src` is deliberately a browser-only program with no
  Node types — the same boundary that makes a stray `import 'react'` in
  `server/` a resolution error.

**Not covered:** the renderer itself, which is WebGL — a browser is its only
check, and the `/run-app` skill drives the app headlessly for that. `App.tsx` is
a route table with no logic of its own.

⚠️ **Every test file is typechecked**, `shared`'s included — `tsconfig.dev.json`
is what pulls its tests and scripts into a program, and the root references it.
See below for why that config exists and why it does not weaken invariant 2.

**Typechecking** reads `shared`'s source directly: `server` and `client` resolve
`@wargame/shared` through its `exports` and pull that source into their own
programs. `shared` emits nothing. `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
`erasableSyntaxOnly` and `verbatimModuleSyntax` are on in every tsconfig.
`shared` has no program of its own for `src`, and its `tsconfig.json` does two
jobs. ⚠️ **It is the name editors look for** — the language server walks up for
`tsconfig.json` *specifically*, so `src` would otherwise be edited under default
options with no `strict`. ⚠️ **And it is the only place `src` has no bun
types**, which makes the rulebook's purity visible while you type: `process.env`
in `combat.ts` is red in the editor rather than a surprise at the gate.

⚠️ `extends` **replaces** `include` rather than merging it, which is why
`tsconfig.dev.json` names `src/**/*.test.ts` explicitly instead of inheriting
`["src"]`. That is load-bearing: it is what keeps `src/*.ts` out of the
bun-typed program.

The root `tsconfig.json` is a solution file over **three** projects: `server`,
`client`, and `shared/tsconfig.dev.json`. ⚠️ That third one covers everything in
`shared` that is **not the rulebook** — `scripts/` and `src/**/*.test.ts` — with
its own `types: ["bun"]`, which is what gives the harness `console` and the
tests `bun:test`.

⚠️ **Types are per-program, so this does not weaken invariant 2.** `src`'s own
config is untouched, and purity is enforced by the **client** program, which
also checks `src` and has no node or bun globals at all. Giving test files bun
types cannot let `process.env` into the rulebook, because the client still
rejects it.

⚠️ An `include` matching an empty directory is `TS18003` and a non-zero exit, so
this config cannot exist before the directory it names has a file in it.
**`@types/bun` is a devDependency of `shared`** — the one package whose defining
property is having none — and that is the price of the test files being
typechecked at all.

## Deployment

One process serves both: `Bun.serve` handles `/api/*` and serves
`packages/client/dist` for everything else. Handlers are stateless. In dev, Vite
proxies `/api` to the server so the same relative paths work.

Migrations run at boot. SQLite needs a persistent disk; an ephemeral filesystem
silently creates a fresh empty database on redeploy.
