# Victory or Death — Architecture

Turn-based strategy game, American Revolutionary War theme. React + TypeScript
+ Babylon.js, built with bun.

**This document describes the code as it is.** No rationale, no history. What
is planned but unbuilt lives in [`roadmap.md`](roadmap.md).

**What plays today:** hot-seat against a real server process. Select a unit, see
the tiles it can reach across terrain, click a destination to pin the route
there and click it again to send the unit walking — then click the unit to stop
there, a tile beside it to end up looking that way, or anywhere else to think
again —
and the turn passes. Two players, a rank of eight each — two guns, two horse,
four foot — on one of six maps chosen when the match is created.

⚠️ **No combat is playable yet, but half of it exists.** Units carry `health`,
and `computeDamage` is complete and tested — what is missing is a command that
carries an attack, which is what makes any of it reachable from the board. Until
then the formula is exercised only by its tests and by the tuning harness.

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
    coordinate.ts     grid arithmetic, directions, and the one tile distance
    queries.ts        lookups over a GameState
    legality.ts       what may be selected
    movement.ts       the search, the path check, and the cost model both call
    terrainGrid.ts    character rows into a tile grid
    armyGrid.ts       character rows into unit placements
    action.ts         command validation and resolution, and the Action brand
    move.ts           the move command
    endTurn.ts        the end-turn command
    turns.ts          the action budget, and whose turn is next
    combat.ts         the damage formula — nothing commands an attack yet
    applyEvents.ts    the event fold
    protocol.ts       the GameServer interface, the wire shapes, and parsing
    testing.ts        fixtures, imported by tests only
    index.ts          the barrel
    data/             the static content tables — unit types, terrain, combat
  shared/scripts/
    matchups.ts       prints hits-to-kill; the one importer of shared/ that is
                      neither server nor client, which only purity allows
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
| `bun packages/shared/scripts/matchups.ts` | The tuning harness: hits-to-kill for every matchup on every terrain. No server, no browser |
| `bun run preview` | `vite preview` — the built client with no `/api` proxy, so it reaches no match |
| `bun run --filter '@vod/server' start` | The production shape: one process serving the API and `dist` together |

Single test file: `bun test packages/server/src/match.test.ts` (`-t 'name'` to
filter); client: `cd packages/client && bunx vitest run src/net/gameServer.test.ts`.

`db:*` must run from the root: `file:` URLs in `DATABASE_URL` resolve against
the repo root, and running them through `bun run --filter` sets the cwd to the
package and loses the single root `.env`.

## The pipeline

```ts
validateCommand(state, command, actor)  → { ok: true, action } | { ok: false, reason }
resolveAction(state, action, roll)      → GameEvent[]
applyEvents(state, events)              → GameState
```

⚠️ **`roll` is an argument, never a field on `Action`.** `validateCommand` is the
only constructor of an Action and has no business generating or receiving dice,
and `shared/` may not produce randomness at all (invariant 2) — so the server
rolls and passes it in. `endTurn` ignores it, deliberately: the alternative
spreads the decision over two places to spare one branch an unused parameter.
That the roll is an *input* is also what lets the tuning harness drive the whole
matchup grid with no server and no browser.

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
   ⚠️ **And the compiler enforces it, via the client.** `shared` has no program
   of its own; its source is checked inside the two that import it. `server`'s
   has `types: ["bun"]` and would happily accept `process.env` in the rulebook —
   but `client`'s has no node or bun globals, so the same line fails there and
   the build exits non-zero. Purity survives because one of the two programs
   checking this source has no operating system. Verified by trying it.
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
Unit        { id, position, facing, unitTypeId, owner, health, hasActed }
GameState   { grid, units, players, currentTurn }    // grid is [row][col]

Command       MoveCommand { type, unitId, path, facing, targetUnitId? } | EndTurnCommand { type }
Action        (MoveCommand & Validated) | (EndTurnCommand & Validated)
              -- a union of intersections, not Command & { actor }: the
              latter would admit an endTurn carrying a path
GameEvent     UnitMovedEvent { type, unitId, path, facing }
            | TurnEndedEvent { type, nextPlayer }
            | BattleResolvedEvent { type, kind, attacker, defender, answered }
              -- attacker/defender are { unitId, health }, resulting

ValidationResult  { ok: true, action } | { ok: false, reason }
CommandResult     { ok: true, seq, events, state } | { ok: false, reason }
StateResponse     { seq, state }
EventsResponse    { seq, events, state? }
MatchSummary      { id, createdAt, seq, currentTurn, mapId }
MapSummary        { id, name }                       // GET /api/maps
ErrorResponse     { error }                          // the body of every non-2xx
```

**A turn is a budget of actions**, `ACTIONS_PER_TURN` in `turns.ts`, and the
turn ends itself once the budget is spent. It is **`null` — no cap — which is
Advance Wars**: every unit acts once, the player picks the order, and the turn
ends when the last of them has gone. A number caps it instead, and at 1 the game
is chess: one unit, one command, over to you. Everything between is one edited
line, which is what the constant is for.

⚠️ **`null` rather than `Infinity`, and the reason is JSON.**
`Math.min(Infinity, roster)` picks the roster for free and needs no branch,
which is what makes it tempting — but `Infinity` does not survive
`JSON.stringify`, coming back as `null` anyway. Ruleset versioning is on the
roadmap, so the day a match records the rules it was played under this becomes
match data and the value would change meaning in transit. One branch, no
migration. ⚠️ And the branch tests `=== null`, not `== null`: the loose form
swallows an explicitly passed `undefined`, which has to keep falling through to
the default.

```ts
actionsTaken(state)    // this player's units with hasActed set
actionsAllowed(state)  // min(ACTIONS_PER_TURN, this player's roster)
actionEndsTurn(state)  // does one more action finish the turn
```

⚠️ **The `min` is load-bearing.** A player with fewer units than the budget
could never reach it, so their turn would never end on its own — "everyone has
acted" has to finish a turn as surely as "the budget is gone".

⚠️ **No state fold is needed to decide.** An action sets `hasActed` on exactly
one unit that lacked it, so the count afterwards is the count now plus one, and
resolution can answer without applying its own events to a copy first.

⚠️ The budget is taken as a **default argument** rather than read from the
module, so the arithmetic stays reachable from a test at any value. Baked in,
the only budget anything could exercise is whichever one the constant holds —
and the case that matters most, a roster shorter than the budget, is invisible
at 1.

`resolveAction` appends `turnEnded` to a move that spends the turn, reusing
`resolveEndTurn` so exactly one place decides who plays next. ⚠️ **Two events,
never one carrying both effects** — invariant 9, and the shape a successful
charge takes later.

**The End Turn command survives the budget** rather than being replaced by it.
It is the early exit: the one thing it does that an auto-end cannot is let a
player stop before committing every unit they are allowed to, which is exactly
the job Advance Wars' own `End` does. At a budget of 1 it is a pass.

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

**`unitTypes.ts`** — `{ id, name, char, movementType, movementRange, range }` per
type. `range` is `{ min, max }` tiles, inclusive, and **read by nothing yet** —
no command carries a target. ⚠️ There is no category beside it: no
`canMoveAndAttack`, no direct/indirect flag. `min: 2` describes a gun rather
than classifying it, and whether a defender may answer is "is the attacker
inside my own range" and nothing else.
`movementType` is `foot`, `horse` or `wheels`, and picks a column out of the
terrain cost table; `movementRange` is the budget that column is spent against.
Also `MAX_HEALTH`, a constant beside the interface rather than a field on it:
nothing varies it, so a per-instance copy would be one number written once per
unit. ⚠️ It lives here so that the day some unit is tougher than another, it
becomes a column of `UnitType` and the edit is local.

**`combat.ts`** — `BASE_DAMAGE`, a nested `Record` of attacker → defender as a
percentage of a full-health target, and `LUCK_MAX`. ⚠️ **A matrix rather than an
attack stat and a defence stat, and that is arithmetic rather than taste:** any
`f(attack, defence)` produces a *transitive* ordering, so no pair of scalars can
express rock-paper-scissors. `road` and `bridge` are currently identical in both
their columns, so the board has five distinct terrains rather than six.

**`terrain.ts`** — `{ char, defense, cost }` per terrain. `char` is the symbol a
map is drawn with; `defense` is stars of cover, read by `computeDamage`; `cost` is
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
}
```

**A map is terrain and nothing else.** Units are deployed onto it by
`createMatchState` from `ARMY`, one hardcoded rank beside the hardcoded
`PLAYERS` and for the same reason — nothing chooses between armies yet.

```
'aciiiica'      // artillery on the ends, cavalry on the wings, infantry between
```

Parsed by `parseArmyGrid` over a `char` column on `UnitType`, which is the same
shape terrain has and exists for the same reason: a legend written once, and
content that is read in a diff. ⚠️ `.` means *empty* in an army and *plains* in
a map — one character, two grids, and safe only because no row is ever parsed as
both.

The rank is **centred** on the board's width, sits on row 0 for the first player
and is placed for the second by a **180° rotation about the board's centre** —
not a copy, which would run both lines the same way down the board. Facing is
toward the enemy: north for the first player, south for the second. Unit ids are
`${colour}-${n}` in **army scan order**, row then column, and are deterministic
because `initial_state` plus the log must replay identically.

⚠️ **A board too small for the army is refused, not clamped.** A negative
centring margin deploys units at negative coordinates — a state that parses,
stores and replays perfectly while being wrong from the first frame.

⚠️ **What a map owes the army is a deployment zone it can stand in.** `wheels`
cannot enter river or mountain at any price, so a board that draws either under
the rank strands a gun where it starts. `maps.test.ts` checks it, and checks
every board against the real army rather than against placements of its own —
so the property under test is the *pair*, which is where the fault would be.

⚠️ **Map ids are immutable.** A match records the id it was built from, so
changing a map's terrain under its id retroactively changes what every existing
match claims to have been played on. A changed map gets a new id.

`getMap` throws on an unknown id, and **`rows[0]` is the row nearest the
camera** — row index increases north, so a map written out top-down is upside
down in the source.

⚠️ **The deployment rows constrain what a map may draw.** The rank lands on
columns 1–8 of the first and last row, and `wheels` cannot enter river or
mountain at any price, so neither may appear there — which in practice means a
river may only leave the board through its east and west edges, or stop short of
the north and south ones. `two-bridges` does the latter, and the river end it
leaves behind is the visible cost of the rule.

⚠️ **Every map is 12×12**, and that is a decision rather than a requirement:
nothing in the code needs boards to agree on a size, and `createMatchState`
centres the rank on whatever width it is handed. `maps.test.ts` asserts it, so it
stays a constraint rather than becoming a coincidence.

⚠️ **Twelve is a middle found by overshooting both ways.** Ten was too tight —
the rank spans eight of its columns, leaving one spare a side and nowhere to go
round a line, which matters because flanking is the mechanic this game has that
Advance Wars does not. Twenty was Advance Wars' own competitive size and too
empty: AW fills that space with properties to capture and bases producing units
all game, and there is no production here. Twelve leaves **two spare columns a
side** at 11% occupancy.

⚠️ If a board plays empty from here the dial is **army size**, not another
resize.

| | |
|---|---|
| `classic` | A river across the middle with one bridge, woods on the near approach and high ground on the far one. Infantry ford anywhere; cavalry and artillery must take the crossing, which is the whole board |
| `crossroads` | A road network closed into a figure of eight. No water and no high ground, so nothing is impassable and cost is the only thing shaping a move — which makes it the board artillery likes |
| `two-bridges` | One river bent through a right angle with a crossing on each arm. ⚠️ Carries **both deck orientations**, which nothing else does: a board with only one leaves half of `bridgeTurns` unexercised |
| `lakeland` | A lake ringing an island, plus a pond. The island is the sharpest thing the cost table can say — water is the one terrain only `foot` may enter, so infantry can hold ground the other two cannot reach at any price |
| `meadow` | Open field, a **lateral** road straight across and one rise in the middle. A road across rather than along helps you redeploy along your own line more than it helps you advance |
| `common` | Open field with the opposite road — up the middle, the fast way *at* the enemy — and hills on both flanks: 4 stars of cover apiece and shut to wheels, so a strong position no gun can ever hold |

⚠️ **A river may only leave the board where the army does not stand.** The rank
lands on columns 6–13 of the first and last row and `wheels` cannot enter water
or rock, so neither may be drawn there. `two-bridges` is where this shows: its
north–south arm stops one row short of the edge rather than reaching it.

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

`reachable` and `settled` are different sets, and they answer different
questions. A friendly unit's tile is settled and walkable-through but is not a
destination, so `pathTo` answers for a larger set than `reachable` lists. The
unit's own tile stays in the map — every path chain terminates there — and
`pathTo(unit.position)` is `[position]`.

⚠️ **`settled` is what the range overlay draws; `reachable` is what decides a
click.** They were one set doing both jobs, which punched a hole in the overlay
wherever a friend stood — and a hole reads as *out of range* rather than as
*occupied*, which is the opposite of true. Not everything lit is clickable, and
that is the point: the overlay answers *how far can I go*, `handleTileClick`
answers *may I stop here*, and a click on a friend selects it instead.

⚠️ `settled` is **exactly** the set `pathTo` answers for, and a test says so —
if they diverge, the overlay is either lighting tiles no route reaches or hiding
ones it does.

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

`shared/src/combat.ts` holds three functions and no state:

```ts
refuseAttack(state, attacker, from, targetUnitId) → string | null
tilesInRange(unit, from, gridWidth, gridHeight)   → Coordinate[]
wouldCounter(defender, from)                      → boolean
resolveBattle(state, attacker, defender, rolls)   → BattleResolvedEvent
computeDamage(state, attacker, defender, roll)    → number
```

⚠️ **One private `outsideRange` answers which side of the band a distance falls
off**, and both callers use it — `refuseAttack` turns it into a reason,
`wouldCounter` asks whether there is one. It was written twice before, as
`< min || > max` for the refusal and `>= min && <= max` for the counter, each
the negation of the other in the same file. Two spellings of one rule is how an
off-by-one arrives.

**A counter fires iff the attacker is inside the defender's own range**, and the
defender survived. ⚠️ **One predicate, no categories.** AW's rule reads "both
units must be direct", which looks categorical and is not — it is equivalent to
*the attacker is adjacent and the defender can fight at adjacency*, because a
direct unit in AW can only attack from range 1. Days of Ruin's Anti-Tank settles
it: indirect out to three, **no minimum range**, and it counters.

⚠️ **Ours differs from AW's in exactly one case, deliberately: counter-battery.**
Two guns within reach answer each other, which AW forbids and history does not.
Artillery caught at one tile still cannot answer, because 1 is not inside
`[2, 5]` — the property worth keeping survives with no rule naming it.

⚠️ **`hasActed` is not consulted.** That flag stops a unit *acting* twice in its
own turn; answering an attack is not acting, so a spent unit still counters.
⚠️ **And a charge never asks** — the counter rule is about shooting, and routing
a charge through it would make charging artillery free.

⚠️ **`tilesInRange` is in `shared` so the band is stated once.** A client
looping with its own `>= min && <= max` to paint an overlay would be a third
spelling of a rule that already had two, and the two were only just merged into
`outsideRange`.

**The client previews the same formula.** `attackForecast` runs `computeDamage`
at roll 0 and at `LUCK_MAX`, which is an **exact range** rather than an estimate
— luck is added last and flat, so those are the true floor and ceiling.
⚠️ The counter's *magnitude* is deliberately absent: it is computed on the
defender's post-damage health, so it depends on how the attack roll lands, and
with health banded the spread comes from band crossings rather than a clean
range. `answered` is read at the **worst** roll, where the defender is likeliest
to survive — so it means *they will fire back unless you kill them*.

`Rolls` is `{ attack, counter }`: named rather than a tuple, and two because two
is the maximum anything needs. ⚠️ **Both are drawn whether or not both are
used** — deciding first and rolling second would make the *number of draws*
depend on the rules, which is the coupling that keeping randomness out of
`shared/` exists to avoid.

⚠️ **`from` is where the attacker *ends up*, not where it stands.** A command is
move-then-attack, so a range measured against `attacker.position` measures a
tile the shot does not happen from. `validateMove` passes the last tile of the
path, having already proven the route walkable.

⚠️ **`resolveBattle` is given the attacker as it is *after* moving.** Nothing in
a first strike reads its position — only its health, and the defender's terrain
— but a counter-attack reads the *attacker's* terrain, which is the
destination's. Building the moved unit at the call site means counters inherit
the right tile rather than retrofitting one.

All three are pure, and the roll is an **input**, which is what lets the tuning
harness run the whole grid with no server and no browser.

```
band(hp) = ceil(hp / 10)                    // 1..10, never 0 while alive
damage   = floor(floor(base × band(attackerHP) / 10)
                 × (100 − stars × band(defenderHP)) / 100)
           + luck                           // last, flat, unscaled
```

**Health is stored and shown 0–100, where AW stores 100 and displays 1–10.**
⚠️ That display was a GBA screen constraint, and inheriting it would mean
permanently explaining why a "9 HP" unit died to 15 damage. Three things people
know AW by follow from *its* choice and not from ours: exact health cannot be
read off the board, chip damage accumulates invisibly until a bar drops, and
counters reliably under-deliver against the preview because the defender answers
on real internal HP while the preview used the rounded display.

⚠️ **Diverging on the display does not mean diverging on the arithmetic.** Both
health terms in the formula read the ten-point band, never the raw value — which
is what AW does, and is load-bearing rather than a rounding preference. Health is
stored and displayed 0–100 here, but feeding raw health to the formula makes a
unit on one point attack at 1% instead of 10%, and the floors swallow it:
measured, cavalry at 4 health or less dealt **zero** to infantry in forest even
on a maximum roll, so two wounded units could be permanently unable to kill each
other. AW has no minimum-damage rule and needs none — the banding is what it has
instead. The cost is accepted: a unit at 91 health and one at 100 fight
identically while the bar shows two different numbers.

⚠️ **Do not port AW's published line literally.** It divides HP by 10 because
its HP is 1–10; taken at face value here, 4 stars against a full-health defender
computes `100 − 4 × 10 × 10 = −300`, and mountains would *heal* whatever stood on
them. `baseDamage` itself needs no rescaling, because it is a percentage of a
full target in both schemes — which is what lets AW's matchup numbers transfer
unchanged. Only the HP terms move.

⚠️ **Luck is added last and flat.** It is therefore worth proportionally *more*
the weaker the attacker is — nine points on a crippled volley of 18 is half again
as much of it. A dead attacker is guarded explicitly, because `band(0)` zeroes
the base but luck would sail past it and land 9.

Three behaviours fall out rather than being rules: a wounded attacker hits
softer, a wounded defender loses its cover (the terrain term scales by *defender*
band, so damaged units cannot turtle on a peak), and striking first compounds.

⚠️ **The counter is `computeDamage` called a second time in the other
direction**, on the defender's *post-damage* health — not a branch inside the
first strike. That is most of AW's exchange calculus for free: striking first
compounds, because a wounded defender both hits softer and keeps less of its
terrain cover. ⚠️ **The attacker's blow lands even when the reply kills it** —
it struck first, which is the mirror of a dead defender never answering.

**One battle is one event.** `battleResolved` carries both resulting healths,
the `kind`, and `answered`. ⚠️ Split events when the parts are independently
meaningful; keep them together when they are one fact — a move stands alone, but
a counter-attack exists *only because* the attack happened. Splitting it would
leave the client inferring which damage belongs to which exchange from position
in a batch, which a multi-action catch-up breaks.

⚠️ **There is no `unitDied` and no `died` flag.** *A unit at zero health leaves
the board* is stated once, in `applyEvents`, so a second event carrying the same
fact cannot disagree with the number beside it. That reducer's filter is
deliberately broader than "whoever this event killed" — nothing else can be
sitting at zero — which is what keeps applying the event twice a no-op.

⚠️ **`answered` is a decision, not a duplicate.** It appears nowhere else, and
reconstructing it means re-running the counter predicate against a rebuilt
state. The log outlives the rules, a deriving client works from a reconstruction
that is only right if its fold is, and `resolutions.events` is a consumer the
moment it is written.

⚠️ **The event union is exhaustively checked.** `applyEvents`' default branch
assigns to `never` before throwing, so a new member is a **compile error** until
it is handled. Without it, adding an event type typechecks cleanly and falls
through to a runtime throw — the one place a missing case would never be
noticed. The throw stays, because events arrive as JSON where types guarantee
nothing.

**Randomness lives in `server/match.ts`**, in `rollLuck` — the only
`Math.random()` in the codebase, because `shared/` is not allowed any.
⚠️ **No seed, and that is invariant 9 paying off**: events carry resulting
values rather than inputs, so a replay reads what happened and never re-rolls.
⚠️ **And no `rolls` column.** Luck is added last and flat, so a roll is
recoverable from the log as `actualDamage − computeDamage(preState, …, 0)` —
storing it would store something the log already contains.

Verified against an independent reimplementation of the AW specification across
113,400 combinations of terrain, matchup, both healths and roll. Sources are in
the module's doc comment, with a note on which wins where they disagree.

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

⚠️ `clickTile`, `commitAttack` and `endTurn` are the verbs. **The panel's two
buttons are the first thing in the game that is not a tile**, and it had to be:
a preview with numbers in it cannot be a tile, and neither can Hold — the only
tile that would face an adjacent enemy is the one they are standing on.

Otherwise A plan is pinned, confirmed
*and* abandoned by a click on the board — whatever is lit does something and
everything else is the way out, in both modes. A refused
submit rolls back to the unit **selected**, not to the destination the server
just refused — handing that back would invite confirming the same move again.

⚠️ **Confirming a pinned route** — a second click on the tile it already ends at
— starts a **preview walk**: the unit moves on screen while
nothing has been sent. `onPreview(next | null)` drives it, and the two cases it
is *not* called on are the design — a confirm and an incoming update both end
with `onSnap` writing an authoritative position over the mesh, so the correction
the renderer already performs is the instruction, and there is no commit verb. It
*is* called on a rejection, which is the one ending that produces no update at
all.

⚠️ `walking` is true until the preview settles, and **nothing is answerable
during it** — `playEvents` skips a move only once its mesh
stands at the destination, so committing early would replay the committed move
from halfway along the path, and a second confirm would start the same walk
twice. That is why `clickTile` closes over `walking`
rather than reading it from a render that may predate the walk, and why the
guard sits at the top rather than inside a phase: a poll can unpin a plan
mid-walk, and the mesh is still moving either way.

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
against has moved and the plan may not even be legal any more. The confirm step
widens the window this can land in: a route now waits for a second click, so an
opponent's move is that much likelier to arrive while one is pinned. Correct,
and the first thing to suspect when a pin seems to vanish on its own.

`worthAnimating` is false for an empty batch, while the tab is hidden, and for
a batch covering more than 28 tiles of walking. The budget counts **tiles, not
events**, because one `unitMoved` can be a six-tile walk and every unit moves at
the same pace — so tiles are what the wait is made of, and the ceiling moved
when the pace did. A failing animation or
snap is caught and logged; the commit always happens.

**`game/interaction/selection.ts`** — pure: no React, no server.

```ts
handleTileClick(state, selection, coordinate) → SelectionState
pinnedDestination(pinned)                     → Coordinate
confirmRoute(routePinned)                     → DestinationChosen
facingChoiceOrigin(arrived)                   → Coordinate
facingChoiceAt(arrived, coordinate)           → Facing | null
holdFacing(state, arrived)                    → Facing | null
unpinDestination(pinned)                      → SelectionState
moveCommandFor(arrived, facing)               → Command
```

⚠️ `pinned` above is **either** phase carrying a path; `arrived` is only the one
that has walked. `unpinDestination` is the sole helper serving both, because
backing out means the same thing in both modes and nothing else does.

`handleTileClick` **never produces a command** — it picks a destination, and
nothing more. ⚠️ A click *can* commit, but the phase dispatch that decides so
lives in `clickTile` above it, which is why this stayed selection-only: every
command's accompanying selection is a constant the caller already knows, so a
paired return would carry no information.

```ts
| { phase: 'idle' }
| { phase: 'unitSelected'; unitId; position; movement }
| { phase: 'routePinned'; unitId; path; movement }
| { phase: 'destinationChosen'; unitId; path; movement; attackTiles }
| { phase: 'targetChosen'; unitId; path; movement; attackTiles; target }
```

`movement` is the whole `exploreMovement` result, snapshotted at selection time.
`reachable` decides whether a click pins; `pathTo` builds the path.

⚠️ **`isPlan` asks whether a phase carries a path**, rather than the callers
listing them by name — which is how `targetChosen` would have been forgotten in
the poll handler that discards a plan when the board moves under it, and in the
End Turn guard. Adding a fifth phase cannot silently miss either.

⚠️ **Three modes, five phases.** *Movement selection* is `unitSelected` and
`routePinned` — the range is lit and both answer clicks identically, which is
why pinning and re-pinning are one code path rather than two. *Action selection* is
`destinationChosen`: the unit has walked, and the tiles around it are a menu.
*The panel* is `targetChosen`: a target is picked and the panel is open over it.
⚠️ Picking a target is a click, not a state — but the panel being **open** is a
mode, because while it is up a tile click means cancel and the buttons are what
commit.

**`readActionClick` is the one reader of an action-phase click**, answering
`commit` / `attack` / `cancel`. ⚠️ It replaced three predicates the caller tried
in turn, and the order was load-bearing with nothing saying so: `facingChoiceAt`
answers a `Facing` for *any* adjacent tile without looking at what stands on it,
so an adjacent enemy satisfied two of them and whichever ran first won. One
function makes that unrepresentable, and turns the rule into a table a test can
walk — where the old shape could only be tested for call order.

**What the overlays draw.** `attackTiles` is the whole attack band, snapshotted
at arrival the way `movement` is at selection — so `showSelection` stays a pure
projection rather than needing the board. ⚠️ Red means *in range*, not
*attackable*: reach is the information. The four tiles beside the unit are the
only place two readings collide, since for a `min: 1` unit they are facing
choices *and* inside the band — **occupancy decides**, so an empty one is a
facing tile and everything else in the band is red.

⚠️ While the panel is up **every overlay clears itself**, with no branch doing
it: `targetChosen` is neither *arrived* nor *pinned*. That is the right
behaviour — every tile click is a way out of the panel, so lighting one would
promise a choice that is not there.

Either pinned phase is a **plan, not a submission** — nothing has been sent, and
a click that means nothing else discards it without the server hearing.
`path[0]` is where the unit still
stands, so unpinning needs no extra field, and the selected unit's own tile is a
destination like any other: that is how acting without moving needs no gesture of
its own, and a single-element path is legal at cost 0. ⚠️ Which also means
clicking the unit **pins standing still** rather than deselecting — the one
gesture this arrangement spends.

⚠️ In `destinationChosen` — and only there — `handleTileClick` returns the
**same object** it was given: the caller has already read the click as a
direction, and a re-render for a click that changes nothing is waste.
`routePinned` is deliberately excluded, because a route is still being chosen
and its clicks are tile clicks.

⚠️ **`destinationChosen` is also the facing choice**, which used to be a phase of
its own. Once the preview arrives, the tiles around the unit are the menu: a
click on the destination keeps the direction travelled (`holdFacing`), a click on
one of the four beside it overrides that (`facingChoiceAt`), and **either commits**
— the direction is the last decision, so there is nothing left to confirm.
Anything further away is ignored. Facing is therefore *offered* rather than
demanded, which is what the design always asked for.

⚠️ The two answers cannot collide: `facingChoiceAt` returns `null` for the
destination itself, because `directionBetween` wants a step of exactly one tile.
`holdFacing` is the only one that needs `GameState`, for the case with no last
step to read — acting without moving keeps the facing the unit already had. The
unit is already standing in the direction it walked, so keeping that facing is a
click on the tile it is looking
at. The renderer clips the four to the board, which costs nothing: facing off the
edge is a strictly worse choice than any of the alternatives.

**`game/GameCanvas.tsx`** — the canvas ref, the renderer lifecycle, and the
chrome around it: the turn label, End Turn, the rejection reason, the
reconnecting banner, and a Toggle Inspector button under an
`import.meta.env.DEV` guard, plus a hint line during action selection. End
Turn is disabled while *either* kind of plan is open, since ending the turn
there would submit around one the player has not answered for.

⚠️ The tile menu lights **on arrival** rather than on confirm: an inert lit tile
invites a click that does nothing. So `showSelection` is a projection of the
selection *and* `walking` — the range stays lit while the unit walks, as the
context the choice was made against, and comes down as the menu lights.

⚠️ **The route and the confirm pane are one affordance**, drawn on
`routePinned && !walking` and gone the instant a route is confirmed, so the
ghost walks over a clean board instead of retracing a line it was already
handed. That predicate is why `walking` is a display input and not just a guard.

**The confirm pane is DOM over canvas** — a small box anchored above the pinned
tile, mounted only while it applies. ⚠️ React populates refs during the commit,
*before* effects run, so the anchor effect finds the element on the render that
introduces it and `null` on the one that removes it, which is exactly the clear.
`pointerEvents: none`, because the tile underneath **is** the button and a pane
that swallowed the click would block its own confirmation. Its container clips,
since `Vector3.Project` does not: a tile zoom has pushed off screen would
otherwise position an absolute child outside the viewport and add scrollbars.

⚠️ The hint line and the pane **hand over rather than overlap** — the pane
belongs to movement selection, the hint to action selection — and between them
they are the only thing naming any gesture, since there are no buttons left.

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
setFacingChoices(around | null)
anchorTo(element | null, coordinate | null)
playEvents(events): Promise<void>
syncUnits(state)          previewMove(unitId, path): Promise<void>
cancelPreview()           toggleInspector()          dispose()
```

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

  ⚠️ **A fit that consults the camera makes the board breathe**, and it is wrong
  at both ends. A square board is half-width across down an axis and
  half-diagonal across at 45°, and its depth projects by `cos β`, which changes
  as you tilt — so reading either rescales a board that has not moved, and a
  mouse drag moves both at once. Verified by probing `orthoTop` through rotate,
  tilt and mixed drags: it does not change at all, while the wheel moves it
  as expected.

  ⚠️ The price is dead space at every angle but the worst one — on a 12×12 the
  board sits in roughly three quarters of the height it could fill looking down
  an axis. That is what a still image costs, and it is the better trade.

  From that, each frame: the frustum is sized so `zoom = 1` is *the whole board
  just fits* — which is both the **floor** the wheel cannot go below and the
  **default** it starts at. The board is the view you play from, and zooming in
  is for detail; starting anywhere else starts the player somewhere they did not
  ask to be, looking at the middle of a board with neither army in frame. The
  target is then clamped per axis to whatever board the viewport does not
  already cover. ⚠️ **Centring is not a rule of its own** — at full
  zoom-out the viewport covers everything, the slack goes to zero, and the board
  is centred with nowhere to pan. It is the clamp at its limit.

  ⚠️ Run every frame rather than on a change, because the orbit, the tilt, the
  zoom and the window all move independently and sixteen dot products is not
  worth the bookkeeping of tracking which.

  ⚠️ **Rotation is free; tilt is not.** `alpha` spins without limit, because
  facing and flanking mean a unit's rear has to be somewhere the player can go
  and look at. `beta` is clamped to a band — **30° to 60° above the horizon,
  starting at 38.6°** — where before it had no limits at all. The shallow end is
  a *legibility* bound rather than a picking one: `screenToTile` searches every
  surface height, so a click stays right however low the camera gets, and what
  degrades is only how much board a raised tile hides.
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
  colours; they are multi-mesh **split by material**, with ten materials across
  the whole set, which is what makes merging by material worth doing;
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

  ⚠️ **Measured off the *loaded* mesh, not the file** — and the difference is
  not academic. The glTF loader flips z on its own `__root__`, which leaves a
  model's bounding box where the raw accessors say it is while putting the
  *relief* on the far side of it. A piece read out of the file therefore comes
  out facing backwards with its extents looking correct, so nothing about the
  numbers gives the mistake away. A probe in the browser settles it in seconds;
  reading the accessors does not settle it at all.
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
  bare. ⚠️ Round robin rather than handing each tree to a randomly chosen tile,
  which is a multinomial and looks like one — measured over a four-by-four wood,
  random assignment left 2 trees on one square against 7 on another with a
  target of 5. ⚠️ The visiting order rotates each pass, because it is not
  neutral: whichever tile goes last has every neighbour's trunk already down to
  dodge, so a fixed order thins the same squares every time.

  ⚠️ The spacing that turns a candidate away is measured **across tile
  boundaries**, which is what makes the group the unit of placement rather than
  the tile. `KEEP_CLEAR` still binds every trunk, because a unit may stand on
  any of those tiles — so each square keeps its hole however the wood is shaped.
- **Six tree shapes**, each turned and scaled, because one stamped repeatedly
  reads as wallpaper. Free: every one is painted `woodBark` and `leafsGreen`, so
  a denser wood costs no draw call — the kit's pines each carry two more
  materials, which is why none is used. ⚠️ **They are scaled to about a third,
  and the pieces set that number rather than the trees.** A tree model is
  1.15–1.71 tall against a unit's 0.39–0.64, so at the size they are drawn a
  wood stands two to four times higher than the army walking through it, and a
  piece reads by standing *over* the wood rather than by being given room in
  it.
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
- **A slab under the board** — `boardBase.ts`, sized to the grid exactly, 0.8
  thick, not pickable and unknown to `surfaceAt`. ⚠️ Plain on purpose: the kit's
  `cliff_*` faces were fitted round the perimeter to make it read as broken
  rock, and came out worse than a box. Every face of them is vertical and the
  only light is hemispheric from above, so the relief takes one shade the whole
  way round and survives as nothing but a bumpy top edge. It is what makes the board an
  object rather than geometry that stops. ⚠️ It hangs off `bottomOf` — the
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
  does — it is a tint, and being inert on a touchscreen costs nothing. The
  route used to be computed here too, from `pathTo` on the hovered tile, which
  meant it existed only under a pointer and a touchscreen never saw one. Showing
  a route needs a *point* input distinct from *select*; touch is the only device
  without one, so the second click supplies it and the route is state now.
- **A unit's health is a ring of ten segments at its base** — `healthRing.ts`,
  extinguishing as it weakens and **absent entirely at full strength**, since a
  ring under every untouched unit is noise. ⚠️ **One segment per band, and it
  calls the rulebook's own `band`** — the same function `computeDamage` reads.
  So 91 and 100 show the same count *because* they fight identically, rather
  than because two constants in two packages happen to agree: the ring computed
  `ceil(health / 10)` itself once, in its own spelling, which made the whole
  claim a coincidence. Ten-for-ten is what stops the display promising precision
  the rules lack. Segments extinguish rather than dim — bands are discrete, and a
  fade would imply a continuum.
  ⚠️ **Parented to the unit's node**, so it rides the walk animation for free and
  is disposed with it. It therefore turns with the unit; accepted, since a ring
  is rotationally symmetric and only the segment boundaries move. It also
  inherits `PIECE_SCALE`, which is wanted — that constant makes each piece fill
  its tile, so the ring stays proportionate to its piece.
  ⚠️ Orange-red, and **not** the amber `SELECTED_COLOR`/`FACING_COLOR` family: a
  ring in that range was tried and read as another selection tint under the
  piece. ⚠️ One material for every ring, cached on the scene by name — so the
  `disposeMaterialAndTextures: false` that protects unit colours protects these
  too.
  ⚠️ **`syncUnits` is its only writer and it never tweens.** The ring is
  persistent state, not an animation: it says how close a unit is to breaking
  while you plan, and showing *change* belongs to the combat cutaway. That also
  keeps it out of `playEvents`, where an animation on the ring would be a
  different target from the unit node and would survive
  `scene.stopAnimation(mesh)`.
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
  ⚠️ **A one-tile path draws nothing**: that is standing still, which Advance
  Wars also draws nothing for, so the case that looks like it needs a fifth
  shape needs none. The atlas is strokes drawn into a `DynamicTexture` with
  canvas 2D at startup — no asset file — in white, with the colour on the
  material's `emissiveColor` so it stays one tunable constant. ⚠️ Babylon's
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
  floor of `emissiveColor` at 28% of the diffuse: units are mostly vertical and
  the only light is hemispheric from above, so their sides fall into shadow
  exactly where the silhouette has to read. Colours are picked to sit against
  the board rather than to be canonical, and green leans to lime because a true
  green sits almost on the grass.
- Model origins are at the base, so a unit's `y` is the surface it stands on
  rather than half its own height — and so scaling a piece grows it upward off
  that surface rather than sinking it through one.
- ⚠️ **Pieces are not at terrain scale, deliberately.** `PIECE_SCALE` in
  `units.ts` is a `Record` per unit type: a unit is a formation rather than a
  man, so no size makes it and a tree both correct, and a piece is sized to read
  on its tile. A table rather than one dial because the models disagree too much
  for a multiplier to close — infantry is 0.48 at its deepest and 0.57 tall,
  cavalry 0.68 and 0.64, artillery **0.80 and 0.39**. Infantry and cavalry are
  scaled to a common height of 0.85; artillery meets its footprint first and
  stays low, which is what lets a gun carriage tell itself apart from the other
  two at a glance. ⚠️ Keyed on `UnitTypeId`, so the key is `artillery` — the
  model file is `cannon.gltf` and the mismatch silently scales a mesh by
  `undefined`.
- Unit meshes are built once at startup; there is no add or remove.
- `playEvents` walks `unitMoved` paths one tween per tile, 0.15s each
  (`FRAMES_PER_TILE` over `FRAME_RATE` in `units.ts` — one dial for every
  unit's pace). Each step turns the mesh before it moves, so a unit walks the
  way it is looking; the turn is snapped rather than tweened.
- `syncUnits` makes the meshes match state: it **removes the dead**, then
  positions *and* orients the living with no tween, stopping any running
  animation first. It **ends any preview** before either — authority overwrites
  every position, so there is no separate commit step, and a live preview holds
  a mesh by id that must not be disposed mid-tween.
  ⚠️ **Removal only, never creation.** Nothing can add a unit to a match:
  `applyEvents` only maps over `units`, and there is no production,
  reinforcement or recruitment. Units enter state once, in `createMatchState`,
  before the renderer is built. ⚠️ Disposal passes `dispose(false, false)`
  deliberately — every unit of a colour shares one material cached on the scene
  by name, and disposing it with the first casualty would leave the rest of that
  army untextured, several turns later and looking unrelated.
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
  and what each mode projects at every stage — pin, re-pin, confirm, walk,
  arrive; `MatchRoute` covers both failure branches, Retry, and disposal
  including a connection that resolves after teardown; `StartScreen` covers
  each of its states and create-and-navigate.

- ⚠️ **`routeArrow.pieceFor` is tested on the same principle**: it is the only
  part of that module that *decides* anything, and a wrong rotation on one of
  the four bends stays invisible until somebody routes that way — a screenshot
  shows one bend at a time, and a browser can only say that something looks off.
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

⚠️ **`shared/`'s own test files are not typechecked** — see *Accepted limits*
in the roadmap. `server`'s and `client`'s test files are.

**Typechecking** reads `shared`'s source directly: `server` and `client` resolve
`@vod/shared` through its `exports` and pull that source into their own
programs. `shared` emits nothing. `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
`erasableSyntaxOnly` and `verbatimModuleSyntax` are on in every tsconfig.
`shared` has no program of its own for `src`, and its `tsconfig.json` earns its
keep twice over. ⚠️ **It is the name editors look for** — the language server
walks up for `tsconfig.json` *specifically*, so a file called anything else is
invisible to it and `src` would be edited under default options with no `strict`
and none of the linting flags. ⚠️ **And it is the only place `src` has no bun
types**, which is what makes the rulebook's purity *visible while you type*:
`process.env` in `combat.ts` is red in the editor rather than a surprise at the
gate. Merging it into `tsconfig.dev.json` would keep purity enforced — the
client program still rejects it — and stop it being legible.

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

⚠️ It could not have existed before the first script did: an `include` matching
an empty directory is `TS18003` and a non-zero exit. And **`@types/bun` is now a
devDependency of `shared`** — the one package whose defining property is having
none. Paid deliberately: with the test files outside every program, a helper
missing a required field and seven calls left at the wrong arity all compiled,
and *twenty* errors surfaced the moment they were covered.

## Deployment

One process serves both: `Bun.serve` handles `/api/*` and serves
`packages/client/dist` for everything else. Handlers are stateless. In dev, Vite
proxies `/api` to the server so the same relative paths work.

Migrations run at boot. SQLite needs a persistent disk; an ephemeral filesystem
silently creates a fresh empty database on redeploy.
