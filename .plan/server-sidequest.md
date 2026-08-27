# Server sidequest — data model, Drizzle, and a first test suite ✅ **shipped**

Two related pieces of work on `packages/server` and `packages/shared`, plus the
repo's first tests.

**Done.** S0 through S7 are all in. `architecture.md` now describes the result;
this document keeps the reasoning, the measurements, and the alternatives that
were rejected — the things a spec deliberately does not carry.

One piece is deliberately not here: **client-side event folding**. `applyEvents`
is exported and the client can import it, but wiring it in is now **step 5b** —
it changes behaviour, and it belongs in the refactor of the code that consumes
events rather than in a storage change.

**Not part of any roadmap phase.** Same category as *turn on `strict`* — it can
land between phases and blocks nothing. `architecture.md` describes the system
this sits inside; this document is the decision record, and folds back into its
Data store and Event log sections once done.

Everything here was verified against working probes. Where documentation or my
own earlier claims disagreed with reality, reality is recorded.

## Two workstreams

Largely **independent**. Only the fold test needs both — but see S1: workstream B
changes `applyAction`'s return type, which `match.ts` consumes, so B's first
increment should land before A's port to avoid rewriting `match.ts` twice.

| | What |
|---|---|
| **A — Storage** | Drizzle over libSQL, real migrations, the new two-table schema |
| **B — Event model** | ✅ **Done** (S0–S2). Events are authoritative and independently applicable; `Action` is a branded validated type. Client-side folding remains, and belongs with phase 5 |

## Why now

**Schema changes are already unmanageable.** `CREATE TABLE IF NOT EXISTS` cannot
alter a table. Add a column and every existing database silently keeps the old
shape, failing at request time rather than at boot. Phase 9's `ownerId` is
exactly that change, and a `sessions` table arrives with it.

**The casts are unchecked.** `row.id as string`, `Number(row.created_at)`,
`JSON.parse(row.current_state as string) as GameState` — the type system asserts
and never verifies, so drift is silent. The `Number()` calls also paper over
libSQL returning integers as `number` *or* `bigint` by magnitude.

**Doing it at five queries is cheaper than at twenty**, and it means phase 9 is
written against the new layer rather than migrated mid-flight.

---

# The data model

## Two tables

```sql
matches      (id, created_at, initial_state, current_state, current_seq, current_turn,
              PRIMARY KEY (id))

resolutions  (match_id, seq, actor, action, events, created_at,
              PRIMARY KEY (match_id, seq),
              FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE)
```

`log_entries` is gone. A **resolution** is one accepted action and everything it
produced — which is exactly what a row is, and what the old name never said.
`actor` is promoted out of the JSON blob because it is the one field of an action
you would ever filter on.

**An earlier draft split this into `actions` and `events` tables.** The
justification was access pattern: events are read on every poll, actions only by
a human debugging, so keeping the hot table small would halve the row read. That
does not survive scrutiny — the two are strictly 1:1 at roughly 80 bytes each, so
it buys half a page read at the cost of a second table, a composite foreign key,
an extra write statement, and a load-bearing ordering constraint inside the
batch. **A 1:1 split with no independent access pattern is ceremony.**

The coherent alternative in the *other* direction is one row per event
(`events(match_id, seq, idx, event)`). That is the shape to revisit if anything
ever queries inside events — see below for why not yet.

## Why the log is rows and not a column on `matches`

Measured, because it looked tempting:

| | 500 commands | poll "since 498" |
|---|---|---|
| events as a JSON column on `matches` | 132 ms · **9.8 MB rewritten** | 0.25 ms |
| append-only rows | 7 ms · **40 KB written** | 0.02 ms |

Every command rewrites the whole blob, so the cost is **quadratic** — a
2000-entry match would rewrite ~160 MB over its life. An append-only log has to
be rows. (That is about *the log* being rows; whether a row holds one event or an
array of them is the separate question below.)

## Why `events` is a JSON array rather than one row per event

- **Events are always consumed as a group.** `playEvents(events)` animates one
  action's events as a batch; the array matches the access pattern exactly.
- The array **preserves order for free**. Rows would need an explicit `idx`
  column and `ORDER BY seq, idx`.
- The atomic write stays small — one statement instead of *N*.
- Nothing queries inside events. Normalising is speculative until something does,
  and migrations make it cheap when something does.

## Why `current_state` stays

**`current_state` is a checkpoint.** Every event-sourced system checkpoints; the
only question is the interval. Keeping the latest is the degenerate case —
checkpoint every 1 event — and it is the simplest possible strategy, not a
departure from the model.

What keeps it honest rather than a second source of truth is workstream B:
events are authoritative, `current_state` is rebuildable from `initial_state` +
events at any moment, and the fold test proves on every run that they agree. If
it ever diverges, rebuild it — the log is the truth.

**It exists for `submit()`, not for reads.** Every command must validate against
current state. The decisive detail: `submit()` **already reads the `matches`
row**, because the concurrency guard needs `current_seq`
(`WHERE id = ? AND current_seq = ?`). `current_state` is in that same row, so
reading it is free. Drop it and `submit` becomes *read the matches row anyway,
plus read the whole log, plus fold* — pure addition, zero saving.

The coherent way to drop it is to drop `current_seq` and `current_turn` too,
making `matches` immutable after insert and all mutation append-only. That is
real event sourcing and a cleaner shape — the `(match_id, seq)` primary key
already catches the race, so the `current_seq` guard is belt-and-braces. **What
breaks it is `list()`**: the start screen shows `currentTurn` for up to 50
matches, which becomes 50 folds — roughly 400 ms to render the lobby. Denormalise
`current_turn` back to fix that and `matches` is mutable again, so you have kept
the write cost and lost the O(1) read.

Three-way, and the middle option is the worst:

| | `submit` | `list()` | |
|---|---|---|---|
| Keep `current_state` | 1 row read | 1 query | O(1) everywhere |
| Drop `current_state` only | 1 row read **+ whole log + fold** | 1 query | strictly worse than keeping it |
| Drop all three (pure) | whole log + fold | **50 folds** | clean model, unusable lobby |

Measured, for the record: materialised read **0.06 ms / 7.1 KB**, fold read
**~8 ms / 158 KB** at 2000 entries (~3.3 ms I/O, ~4.7 ms apply). The CPU is cheap
— it is the growth and the per-command repetition that are not, and Turso meters
rows read.

**The honest cost of keeping it:** ~7 KB rewritten per command — linear, not
quadratic. Over a 2000-command match, ~14 MB of writes against the log's ~150 KB.
Most of that 7 KB is the **`grid`, which never changes during a match**. The fix,
if it ever matters, is deriving `grid` from `map_id` rather than carrying it
inside `GameState`. Not now: `GameState` is a wire type the client needs whole,
and splitting it would leak storage concerns into the protocol.

*(Also note invariant 1 rules out the in-memory alternative: "the database is the
only mutable state… reintroducing a cache would break statelessness.")*

## Two rules for event design

**1. Every event must be independently applicable to the state that precedes
it.** This is what makes one-at-a-time folding work, and therefore replay to any
point. Both current events satisfy it. Future ones must be designed for it —
a successful charge emits `unitDied` **+** `unitMoved`, two self-contained
events, not one compound event carrying both effects.

**2. Events carry absolute values, not deltas.** This is what makes them
idempotent, which was verified:

```
unitMoved applied twice === once : true
turnEnded applied twice === once : true
```

⚠️ **The combat trap this predicts.** The doc's sketched
`unitAttacked { attackerId, targetId, damage }` is a **delta** — applied twice it
deals 24 (`{hp:100}` → twice → `{hp:76}`, proven). It must carry the resulting
value instead: `{ attackerId, targetId, targetHp }`.

**`damage` is then not stored at all** — the client folds in order, so it holds
the pre-state and derives `damage = before − after` for the floating number.
Nuance: on overkill (8 HP unit takes a 12 roll) the derived number is 8, which is
arguably the truer figure since 8 is what landed. If the *roll* is ever wanted for
display, it lives on the Action alongside the dice.

**What idempotency buys, precisely:** at-least-once application is safe, so a
client replaying does not need perfect `seq` bookkeeping. **It does not buy
order-independence** — idempotent ≠ commutative. Two moves of the same unit
applied in reverse give a different position (verified). Ordering by
`(seq, index)` stays mandatory.

## Command / Action / Event

```
Command  ──parse──▶  Command  ──validate + actor──▶  Action  ──resolve + dice──▶  Event[]
(wire, unknown)      (well-formed)                   (accepted)                   (facts)
```

- **`Command`** is a DTO. Client → server, intent only, **never stored.** A
  command log for anti-cheat is a genuinely good idea and firmly out of scope.
- **`Action`** means *accepted*. Not "authenticated candidate" as today.
- **`GameEvent`** is a resolved fact, and the only thing that mutates state.

**`Action` is a branded type, and `validate` is its only constructor.** Verified
under this repo's exact settings — `strict` **off**, `erasableSyntaxOnly` on:

```ts
declare const validated: unique symbol
export type Action = Command & { actor: PlayerId; readonly [validated]: true }

export function validateCommand(state, command, actor): ValidationResult  // only constructor
export function resolveAction(state, action: Action): GameEvent[]         // uncallable otherwise
export function applyEvents(state, events): GameState                     // the only mutator
```

| | |
|---|---|
| legitimate `validateCommand` → `resolveAction` | ✅ compiles |
| forging `resolveAction(s, { type: 'endTurn', actor: 'p1' })` | ❌ *"Property `[validated]` is missing"* |
| reviving from `JSON.parse` without a cast | ❌ same |

⚠️ **This changes invariant 5, and strengthens it.** Today `applyMove` has to
*remember* to call `canMoveUnit`; nothing enforces it. With the brand, an
unvalidated action is **unrepresentable** — resolution cannot happen without
validation, at compile time. The invariant's wording needs updating rather than
quietly reinterpreting.

**One consequence:** reading an action back from the database gives an unbranded
object. That cast belongs in exactly one named function — `trustLoggedAction()` —
so the hole is visible. It is rarely needed, since replay uses events.

## No concept of a turn

A turn is not modelled and does not need to be. The log is a flat series of
Action → Events; `actor` is on every row; turn boundaries are derivable by
counting `turnEnded` events if a replay UI ever wants them.

Worth recording the granularity, because it is easy to trip on: **a row is a
*ply*, not a turn.** In chess a numbered move is white's ply plus black's; in
Advance Wars a turn is *N* plies by one player, so a turn spans several rows.

## Column-level decisions

| | |
|---|---|
| `initial_state` | **Kept.** Write-only on purpose — the replay anchor, and it cannot be backfilled. Phase 6 offers an alternative (derive it from `map_id`), rejected because it would make map definitions immutable forever |
| `map_id` | **Phase 6**, for provenance and display. `initial_state` stays the authoritative snapshot |
| `current_seq` / `current_turn` | **Kept** denormalised. The concurrency guard needs one; listing without parsing a board needs the other |
| `created_at` on `resolutions` | **Kept**, and now justified — phase 9's async play needs "waiting on you since when", whose source is `max(created_at)` for a match. It was previously write-only *and* unexplained, unlike `initial_state` |
| Index on `matches.created_at` | **Deferred.** Not because 5 rows are small, but because phase 9 scopes listing by owner and would want `(owner_id, created_at)` — a *different* index. Building the wrong one now costs write amplification |
| `owner_id`, lobby `status` | **Phase 9.** Their arrival is what exercises the migration path, which is the point |
| `created_at` as INTEGER epoch ms | Correct in SQLite (64-bit). App-supplied rather than a DB default, keeping the clock injectable for tests |
| `WITHOUT ROWID` | Both tables qualify, but drizzle-kit does not emit it and the gain is negligible |
| Foreign keys | **Added.** libSQL enables `PRAGMA foreign_keys` **by default** (verified — unlike stock SQLite), orphan inserts fail, and cascade genuinely cascades |

---

# Workstream A — Drizzle

## Turso is unaffected — verified

`drizzle-orm/libsql` **is** the Turso adapter. The connection string is the
entire difference:

```ts
createClient({ url: 'libsql://your-db.turso.io', authToken })  // ← the whole diff
drizzle(client, { schema })                                     // unchanged
```

A remote-URL client wraps in `drizzle()` without complaint,
`drizzle-orm/libsql/{http,ws,web,node,sqlite3}` all resolve, and drizzle-kit has
an explicit `turso` dialect that also works against a local `file:` URL — so one
config covers both environments.

Deeper insurance: schema and query layers live in `drizzle-orm/sqlite-core`,
which is **driver-agnostic**. A driver swap changes the line that constructs the
client and nothing else.

## The transaction mode is preserved — the key finding

Drizzle's `db.batch()` calls `client.batch(queries)` with **no mode argument**,
and `db.transaction(fn, _config)` ignores its config — both verified by reading
`drizzle-orm/libsql/session.cjs`. libSQL defaults both to `deferred`, which would
silently drop the deliberate `'write'` (`BEGIN IMMEDIATE`) that `match.ts` uses.

The resolution keeps both properties:

```ts
const logIt  = db.insert(resolutions).values({ … }).toSQL()   // typed construction
const update = db.update(matches).set({ … }).where(…).toSQL()

const [, updated] = await client.batch(
  [logIt, update].map((q) => ({ sql: q.sql, args: q.params })),
  'write',                                                     // mode survives
)
if (updated.rowsAffected !== 1) throw new Error(`match ${matchId} moved under us`)
```

`.toSQL()` returns `{ sql, params }`, which the raw client accepts. So we keep
schema-checked query building **and** `BEGIN IMMEDIATE` — and `rowsAffected`
comes back, which lets us **assert the guarded UPDATE actually matched**. That
guard exists today and has never been checked.

## Verified by probe

| | |
|---|---|
| **Typed JSON, first-party** | `text('current_state', { mode: 'json' }).$type<GameState>()` — assigns to `GameState` **with no cast**, clean under `--strict` |
| **Generated SQL matches the live schema** | drizzle-kit emits `text` columns and composite primary keys byte-compatible with the hand-written DDL |
| **All five query shapes port** | exercised against a real file |
| **Footprint** | `drizzle-orm` 16 MB, zero hard dependencies. `drizzle-kit` dev-only |

## Dependencies

`server/` only; `shared/` and `client/` untouched.

| | |
|---|---|
| `+ drizzle-orm@0.45.2` | runtime; zero hard dependencies |
| `+ drizzle-kit@0.31.10` | dev only |
| `@libsql/client@0.17.4` | **stays** — it is the driver Drizzle sits on |

## New files

- **`src/schema.ts`** (~40 lines) — the two tables in `sqlite-core`, with
  `$type<>()` on the JSON columns, a composite primary key on `resolutions`, and
  the foreign key. Imports types *from* `shared/`, never the reverse.
- **`drizzle.config.ts`** — `dialect: 'turso'`, with **repo-root-relative** paths.
- **`drizzle/`** — generated migration SQL plus `meta/` snapshots.
- **`schema.sql`** — the whole current schema as readable DDL from
  `drizzle-kit export`, refreshed by the same script that generates migrations.

⚠️ **Migrations are committed, unlike `dist-types/`.** We deleted that directory
because generated artifacts that go stale weren't paying for themselves. The
distinction is real: `dist-types/` was a derivable typechecking optimisation;
migration SQL is the *record of what has been applied to real databases* and
cannot be regenerated from the schema alone. Add `drizzle/` to `.prettierignore`.

## `db.ts`

```ts
export interface Database {
  db: LibSQLDatabase<typeof schema>   // typed queries
  client: Client                      // pragmas, and the write-mode batch
  url: string
}
```

`createDb(url)` keeps its signature and default so tests can point it anywhere.
`migrate()` drops both `CREATE TABLE IF NOT EXISTS` blocks for Drizzle's
migrator, and keeps WAL and `busy_timeout` raw via the client, still gated on
`file:`.

## `match.ts` — the queries

| | Removes |
|---|---|
| `loadMatch` | 2 casts, 1 `Number()` |
| `create` | 1 `JSON.stringify` |
| `list` | 4 casts, 2 `Number()`, **and the interpolated `LIMIT`** |
| `since` | 2 casts |
| `submit` | 3 `JSON.stringify`; **adds** the `rowsAffected` assertion |

Net: **6 `as` casts, 3 `Number()` coercions, 5 `JSON` calls, and the only
string-interpolated SQL in the codebase** — all gone.

## The single root `.env`, and why `db:*` scripts live at the root

`architecture.md` commits to one `.env` at the repo root. Honouring that needs
care. All verified:

| | |
|---|---|
| bun auto-loads `.env` from **cwd** | ✅ no `dotenv` needed — `bunx drizzle-kit` saw it |
| bun walks **up** to a parent `.env` | ❌ |
| `bun --env-file=X x <cli>` propagates | ❌ the cwd `.env` won |
| `process.loadEnvFile()` | ❌ not implemented in bun 1.3.14 |
| drizzle-kit resolves `schema`/`out` from **cwd** | ✅ — the lever |

Because `bun run --filter` sets cwd to the package, a filtered script would never
see the root `.env`. So **`db:*` scripts live only at the repo root**, and the
config's paths are root-relative:

```json
"db:generate": "drizzle-kit generate --config packages/server/drizzle.config.ts
                && drizzle-kit export --config packages/server/drizzle.config.ts
                   > packages/server/schema.sql",
"db:migrate":  "drizzle-kit migrate  --config packages/server/drizzle.config.ts"
```

Verified end to end in a monorepo-shaped probe. **This deliberately breaks the
existing `--filter` pattern** — worth a comment in `package.json` so nobody
"fixes" it. And note `drizzle-kit export` writes SQL to **stdout**, so the config
must not log anything or it corrupts `schema.sql`.

**No `dotenv`.** The examples that use it are written for Node. Bun does this
natively, and the real problem is "bun doesn't walk up", not "env files need
parsing".

## Schema authoring and migrations

Drizzle's schema is declarative; it is declared in TypeScript rather than a DSL,
and there is **one fewer concept than Prisma** — no generated client, because
types are inferred from `schema.ts` directly.

| | Prisma | Drizzle |
|---|---|---|
| 1 | edit `schema.prisma` | edit `schema.ts` |
| 2 | `migrate dev` | `db:generate` (diff + write + refresh `schema.sql`) |
| 3 | | `db:migrate` — or `migrate()` at boot |
| 4 | `prisma generate` → client | *nothing* |

Drizzle **diffs against JSON snapshots** in `drizzle/meta/`, not against the live
database — offline and deterministic, no shadow database, but it will not notice
a schema altered out of band. For one developer with no manual DDL that is the
simpler side of the trade; `drizzle-kit check` covers migration consistency.

`drizzle-kit push` is deliberately **not** used: fine for prototyping, wrong for
anything with history.

---

# Workstream B — the event model ✅

## `applyEvents`, and the fold

Proven with a 25-line `applyEvent` over the two existing event types:

```
events in log: 4
fold(initial, events) === current_state:  true
 after event 1 (unitMoved): turn=b  b1={"col":2,"row":0}
 after event 2 (turnEnded): turn=r  b1={"col":2,"row":0}
 …
```

Byte-identical. **The chess property is achievable with the current event set** —
no new event types, no schema change, just the missing fold function. And because
it applies one at a time, state at *any* point comes free, including mid-resolution.

Shape:

```ts
applyEvents(state, events) → GameState   // the only mutator; a fold over applyEvent
```

Reducers stop returning state and return events; `applyEvents` produces state.
One mutation path, so live play and replay cannot diverge — the chess property
becomes true by construction rather than by hope.

## The client folds too ⬜

Not built. `applyEvents` is exported from the barrel and the client can already
import it; wiring it in belongs with phase 5, which is the refactor of the code
that consumes events.

A client joining late, or recovering from lost state, replays events to the
current position rather than depending on a snapshot. Folding *facts* is not
resolving anything, so **invariant 8 is untouched** — the line stays
"deterministic preview yes, random resolution no."

This is also the fix for the latent bug the roadmap parks at **7c** —
*"state commits before animation finishes."* If the client applies each event as
it animates it, its view tracks the animation instead of snapping to the end
state.

`{ events, state }` should still both come over the wire: folding makes replay
correct, and the snapshot is what makes a *missed* event self-healing.

---

# Plan

Increments. Each leaves `lint`, `typecheck`, `build` and `test` clean and the
game playable. `MatchStore`'s interface never moves, so `http.ts` is untouched
throughout and any increment can be the last one.

**S0 — Tests first, against the code as it stands.** ✅ **Done.** Both runners: `bun test`
for `shared/` and `server/`, Vitest in `client/`, plus the root `test` script.
Cover `handleTileClick`, `parseCommand`, the reducers, `getReachableTiles`. No
production changes. Lands phase 5's missing safety net as a side effect.

**S1 — `applyEvents` in `shared/`.** ✅ **Done.** Workstream B's core. Reducers stop returning
state and return events; `applyEvents` folds. Adopt both event design rules while
there are only two event types. Add the fold test — which gives the storage work
a correctness check to run against.

*Not purely `shared/`:* `applyAction`'s return type changes from
`{ ok, state, events }` to `{ ok, events }`, so `match.ts` must call
`applyEvents` itself to get the next state. That is a few lines, but it means
**S1 should land before S5–S6** — otherwise `match.ts` gets rewritten twice, and
the storage port happens against a shape that is about to change.

**S2 — Branded `Action`, `validateCommand` / `resolveAction`.** ✅ **Done.** The rest of workstream B.
Separable from S1, and optional if it feels like scope creep — S1 delivers the
chess property on its own.

**S3 — Schema, unused.** ✅ **Done.** `src/schema.ts` and `drizzle.config.ts`. Run
`drizzle-kit generate` and **diff the generated SQL against `PRAGMA table_info`
on the live database** — prove the schema was written from observed reality
before anything depends on it. Nothing imports it yet.

**S4 — The schema moves.** ✅ **Done.** `db.ts` switches from `CREATE TABLE IF NOT EXISTS` to
the Drizzle migrator, pragmas preserved and still gated on `file:`. Delete the
local `aw.db` and let migrations create it.

⚠️ **`match.ts`'s two `log_entries` statements move to `resolutions` in the same
increment**, still as raw SQL. Otherwise the table the server reads and writes
stops existing the moment the migrator runs, and the game is broken from S4
until S6 — which the "every increment leaves it playable" rule forbids. Four
lines: two table names and the new `actor` column.

That makes the split cleaner than it first looked: **S4 is the schema change,
S5–S6 are the query-layer change.** Neither touches the other, and each reverts
on its own.

Two details. The migrator's `migrationsFolder` must resolve from
`import.meta.url` rather than cwd — the same dependency the `DATABASE_URL` fix
removed, and leaving its twin would be half a job. And Drizzle exports its own
`migrate`, so the import needs an alias.

**S5 — Port the reads to Drizzle.** ✅ **Done.** `loadMatch`, `list`, `snapshot`, `since`,
`create` — raw SQL to typed queries, against the schema S4 already put in place.
Add the `MatchStore` tests here; they make S6 safe.

**S6 — Port `submit`** ✅ **Done.** to the two-statement `.toSQL()` batch — insert the
resolution, update the match — with the `rowsAffected` assertion.

**S7 — Fold back into `architecture.md`.** ✅ **Done.** Rewrite Data store and Event log;
reword invariant 5 for the branded type; document how to add a migration; note
the concurrency design is unchanged and why; drop the "no migration framework
yet" comment in `db.ts`.

## Resolved

| | |
|---|---|
| Adopt or recreate | **Recreate.** No data worth keeping. Still do the S3 schema diff |
| `:memory:` for tests | **Works with the migrator** — verified. Per-test isolation, no temp files |
| `turso` dialect | **Confirmed** — one config for local and deployed |
| Commit `schema.sql` | **Yes, with the drift test** (#7 below). Alone it is documentation; the test makes staleness a failure |
| Foreign keys | **Cascade**, not restrict |
| `turn_no` | **No.** Turns are not modelled |
| Store actions | **Yes, from the start** — for debugging and audit. You cannot recover actions from a period you weren't storing them |

---

# Tests

**Two runners, split by package.** `bun test` for `shared/` and `server/`,
**Vitest** for `client/`. Both verified: `bun test packages/shared packages/server`
scopes correctly, and Vitest ran in `packages/client` with **zero configuration** —
it picked up the existing `vite.config.ts` — passing 4 tests in 129 ms.

```json
"test": "bun test packages/shared packages/server && bun run --filter '@aw/client' test"
```

with `"test": "vitest run"` in the client.

**The test files are portable.** The same `handleTileClick` suite ran under both;
the only difference was `from 'bun:test'` versus `from 'vitest'`.

⚠️ **Vitest lands at S0, not "eventually."** `handleTileClick` lives in `client/`
and it is the test phase 5 most needs. Phase 5 also *creates* `useGameSession`, a
hook — and hooks need a DOM, which is `jsdom`/`happy-dom` under Vitest. It earns
its place at phase 5, not later.

Babylon needs WebGL, which neither runner provides — permanently a real-browser
job. Full request/response is Playwright's layer.

## What to test, in value order

1. ✅ **`handleTileClick`** *(client · Vitest)* — 11 tests. Phase 5's union
   conversion is a shape change to exactly this input, so about half will need
   their assertions updated — which is the point of writing them first.
2. ✅ **`parseCommand`** *(shared)* — 19 tests. The security boundary. Malformed bodies, extra
   properties dropped, `MAX_PATH_STEPS`, and the exhaustive `default`.
3. ✅ **Validation and resolution** *(shared)* — actor checked first, `hasActed` set on move and
   reset for the incoming player only, each rejection reason.
4. ✅ **`getReachableTiles`** *(shared)* — own tile excluded, enemy tiles impassable,
   friendly tiles pass-through but not stopping points.
5. ✅ **The fold** *(shared)* — `applyEvents(initial, events)` equals `current_state`.
   Also: every event applied twice equals once, and reordering changes the result.
6. ✅ **`MatchStore`** *(server)* — 19 tests. — `create → submit → snapshot → since`, the
   primary-key race on a duplicate `seq`, the `rowsAffected` guard, and that
   deleting a match cascades its resolutions away. Against `:memory:`.
7. ⬜ **Schema drift** *(server)* — not built; `schema.sql` is regenerated by
   `db:generate` and unverified between runs. — migrate a fresh `:memory:` database, read back
   `sqlite_master`, compare against the committed `schema.sql`. Verified working.

Items 1–5 are done: 1–4 in S0, the fold in S1. 6 and 7 arrive with S5 and S4.

---

# Rejected alternatives

All findings from probes, not documentation.

**Prisma** — evaluated at length. Three findings decided it:

- **JSON columns type as `JsonValue`**, which does not assign to `GameState`
  (`TS2322`). Every read would need `as unknown as GameState` — a *double*
  assertion, worse than what this removes. Fixing it needs the community
  `prisma-json-types-generator`. Drizzle does it first-party in one line.
- **333 MB of `node_modules`** against Drizzle's 16 MB, for three tables.
- **Prisma 8 removes SQLite entirely.** `prisma orm init --target sqlite` →
  *"is not one of: postgres, mongodb."* Package names all change
  (`@prisma/orm-postgres`, `@prisma/cli-engine`), the schema becomes a "contract"
  in a new PSL dialect, and `@prisma/client` has no 8.0.x release at all — only
  `8.1.0-dev` builds, while the CLI's `latest` points at `8.0.0-rc.12`.

  This is what killed it. Prisma won the first evaluation on **engine
  portability** — one schema file, change `provider` to `postgresql` later. That
  promise does not survive version 8, which has no SQLite to migrate *from*.

  *Fair to Prisma:* Apache-2.0, `prisma orm init` needs no account, and the
  scaffold points at a plain local Postgres rather than their hosted product.

**Kysely** — best type inference of the group, but the libSQL dialect is
third-party (`@libsql/kysely-libsql@0.4.1`, depending on `@libsql/client ^0.8.0`
while we run 0.17.4), and it has no migration story.

**MikroORM / TypeORM** — MikroORM's Unit of Work solves problems we do not have
over rows that are JSON blobs. TypeORM has no libSQL driver.

**Atlas for migrations** — the best migration tool evaluated, but
`atlas-provider-drizzle` is unpublished and it puts a Go binary in the toolchain.

**Postgres** — deferred, not rejected. One concrete trap for whenever it happens:
`created_at` holds `Date.now()` (~1.79 × 10¹²), which overflows Postgres
`INTEGER` (int4, max 2.1 × 10⁹). It works in SQLite only because SQLite integers
are 64-bit. That column must become `BIGINT` or `TIMESTAMPTZ`.

**Raw SQL plus a `sql` tag and typed row decoder** — ~40 lines, zero
dependencies, and the only option giving *runtime-checked* coercion rather than
an assertion. **The fallback if this stalls.** The two should not both be built.

---

# Not in scope

- **Runtime validation of the JSON blobs.** `$type<GameState>()` is a
  compile-time assertion. Real validation needs a validator, and its natural home
  would cost `shared/` its zero-dependency property.
- **A command log** for anti-cheat or replay-of-intent. Genuinely useful later;
  `Command` stays a DTO for now.
- **Storing rejected actions.** The `actions` table is the natural home when it
  happens, and it would finally make the doc's "who tried what" claim true.
- **Hono for the HTTP layer.** Independent of storage and worth doing on its own
  merits — declarative routing, plus `hono/logger`, `hono/secure-headers` and
  `serveStatic` close three gaps already identified. Its own sidequest.
- **Normalising `events` to one row per event.** Revisit if anything ever queries
  inside them.
