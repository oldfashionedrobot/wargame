# Phase 5a — settled decisions

Scratch doc. Everything here belongs in `architecture.md` once 5a lands; absorb
it and delete this file, the way `server-sidequest.md` went.

Nothing below is built. The repo is at the state 5a starts from.

## The three decisions the doc asked for

### 1. How does the canvas learn the selection? → **an `onSelectionChange` callback**

`useGameSession` owns the selection and hands it out through a callback the
canvas supplies; the canvas pushes it to the renderer imperatively, as the three
`showSelection` calls already do.

**This reverses an earlier choice of returning it as state.** That option is the
more idiomatic React, and it makes the hook assertable without a renderer — but
the second argument was weak (a spy `onSelectionChange` is just as assertable),
and the first costs more than it looked:

- two new effects in the canvas, one to push the selection and one to
  re-register the click handler
- the click handler's identity changes with the selection, which is the *only*
  reason the fourth decision below exists
- it pulls the renderer into state, or leaves three effects resting on
  declaration order

The callback keeps the handler stable and registered once, keeps the push
reading `server.getState()` rather than the render replica, and leaves the
renderer a `ref`. Fewer moving parts for the same separation.

Cost, accepted: mirroring an imperative API through a callback is less idiomatic
than state → render → effect. But the renderer *is* an imperative API, and the
hook still never learns what Babylon is.

### 2. One subscription or two? → **one, in the hook, with an `onEvents` callback**

Today's single callback sets state, clears rejection, *and* animates. The first
two belong to the hook and the third to the canvas, so two listeners was the
obvious split — `gameServer` already fans out to a `Set`.

Chosen against, because **5b needs the fold and the animation interleaved**: the
hook applies each event as the renderer animates it. Two listeners would be
split in 5a and merged again in 5b. The canvas hands the hook an animate
function instead; the hook still never learns what Babylon is.

The signature will still change in 5b — array-and-sync becomes
per-event-and-awaitable. That is churn this avoids only partly, not entirely.

### 3. `submitCommand`'s `!renderer` guard → **accept that it disappears**

The guard exists mostly to bind `renderer` for the `showSelection` calls below
it, and the `pendingRef` half of the condition survives untouched. Its only real
effect is refusing End Turn in the window before the renderer effect runs.
Nothing is lost: under decision 1 the selection-push effect fires whenever the
renderer appears.

Disabling the button until the renderer exists was rejected as new behaviour in
an increment that is supposed to have none.

## What those choices force, which `architecture.md` does not cover

### ~~A fourth decision: the click handler has to be re-registered~~ — moot

This existed only under returned-state: `clickTile` would close over the
selection, change identity on every selection change, and need re-registering
because the renderer captures the handler once. Under the callback the handler
is stable and registered once inside the renderer effect, exactly as today.

Worth keeping the finding that settled it either way: `onTileClick`
(`renderer.ts:133`) *sets* `clickHandler` rather than adding to a list, so
re-registering would have been safe. Verified by reading it.

### ⚠️ Resolved: `server` *can* change under a mounted `GameCanvas`, and that is a bug

The open question was whether renderer-as-state solved anything real. It does
not — but only because the underlying problem should be fixed where it lives.

`MatchRoute` never resets `server` when `matchId` changes, and react-router
reuses the component instance for a param change on the same route. So
navigating `/a` → `/b`:

1. renders with `matchId = 'b'` but `server` still A's and `failure` still null,
   so **`GameCanvas` renders against A's server**
2. the effect cleanup runs — `cancelled = true`, `connected?.dispose()` — so **A
   is now disposed**
3. the new effect connects to B
4. B resolves, `setServer(B)`, and the canvas takes a **new server prop without
   unmounting**

Between 2 and 4 the canvas shows match A's frozen board while the URL says B,
against a disposed connection.

**Fix it in `MatchRoute`, not in the canvas.** Two lines at the top of the
connect effect:

```ts
setServer(null);
setFailure(null);
```

A match change then shows "Connecting…", which is correct, and `server` can no
longer change under a mounted canvas — so **the renderer stays a `ref`**.

Hard to reach today: you need browser back/forward between two adjacent match
URLs, since nothing in the app links match → match. Phase 9's lobby makes that
navigation ordinary, which is the other reason to fix it now rather than record
it.

### `onEvents` stability is load-bearing, and silently so

`subscribe` fires `onUpdate([], state)` **synchronously** (`gameServer.ts:137`),
and the hook's listener calls `setRejection(null)`.

So if `onEvents` sits in the subscription effect's dependency array and is not
perfectly stable, the effect re-runs on every render and wipes the rejection
before it can be seen — a refused command would show nothing at all. Decision 2
plus renderer-as-state *guarantees* the instability, since the animate callback
must close over the renderer.

Fix: hold `onEvents` in a latest-ref so the subscription depends only on
`server`. Cheap, but it is the difference between 5a being a no-op and quietly
breaking the rejection UI.

### ~~Two honest behaviour deltas~~ — both were consequences of returned state

Under returned state the highlight would have re-pushed on every authoritative
update (because `showSelection` derives the selected unit's *position* from
state, so `state` had to be in the effect's deps), and the push would have read
the render replica rather than `server.getState()`.

The callback has neither. The push stays at the same three call sites, reading
the same source, on the same occasions. **So the refactor steps of 5a are
genuinely zero-behaviour-change** — only step 2, teaching the client about 422,
changes anything a user sees.

⚠️ Still true, and the easiest mistake to make: **`clickTile` must read
`server.getState()`**, not the hook's replica (invariant 1). The replica is in
scope and it is tempting; using it means acting on a board a beat old.

## Proposed order

Six separately verifiable steps:

0. **Turn on `strict`.** Measured at zero errors across every package, so this
   is a flag flip rather than the risky increment it was parked as — see 5a in
   `architecture.md`. First, so the code the later steps write is written
   under it rather than retrofitted.
1. **`net/gameServer.ts` tests + the `applyUpdate` simplification.** Independent
   of the refactor, so they are a net the refactor cannot invalidate. Note the
   poll loop reschedules from an async callback, so the tests need
   `vi.advanceTimersByTimeAsync`, not the sync form. `visibilitychange` stays
   out of reach until 5b adds a DOM.

   ⚠️ **Do not assert on the text of a transport failure.** `HttpError`'s
   message is built from the status code today (`server returned 400`), and the
   server now sends a real reason in the body that the client will start reading
   — see the 422 section below. Assert the `kind` and that `ok` is false; a test
   pinned to today's wording would have to be rewritten by a change that is
   otherwise additive.
2. **Teach the client about 422.** The server already sends it — see the
   section below. After step 1 so the new tests cover it, and as its own commit
   because ⚠️ **this is the one step of 5a that changes behaviour**: error text
   the user sees, and whether the reconnecting banner appears. Everything else
   here is shape-only.
3. **`SelectionState` becomes a union**, plus the four assertions in
   `selection.test.ts` that touch the record shape (lines 29, 30, 82, 94 —
   the doc's count is exact; the other seven tests survive untouched).
4. **Fix `MatchRoute`'s stale server** — two lines, its own commit, and a real
   bug fix rather than refactor. See the resolved ⚠️ above. Before the
   extraction, because it is what lets the renderer stay a `ref`.
5. **Extract `useGameSession`.**

## Parked questions, unrelated to the three above

### ✅ Command rejections answer 422 — server done, client owed

**The server half is built.** `POST /commands` now answers **422** with
`{ error: reason }` when the rules refuse a well-formed command, keeping 400 for
a body that was never a command and 404 for a missing match.
`MatchStore.submit` returns `CommandResult | null`, so `ok: false` means exactly
one thing and each status is a one-line mapping.

**The client half is step 2 below, and it is owed rather than optional.** Until
it lands the game is visibly worse than before: `client/net/api.ts:39` throws on
any non-2xx that is not 404, so a rejected move surfaces as *"rejected: server
returned 422"* and falsely flips the UI to "reconnecting…". Two small edits, and
`GameCanvas` does not change at all because `submit()` still returns
`CommandResult`:

- **`client/net/api.ts`** — add `'rejected'` to `FailureKind`, and on a 4xx read
  the `ErrorResponse` body so `HttpError` carries the server's wording instead of
  "server returned 422".
- **`gameServer.ts:127`** — when the kind is `rejected`, return
  `{ ok: false, reason }` *without* `setStatus('retrying')`. That also retires the
  conflation this section used to describe: a transport failure and a rule
  rejection currently arrive at the UI wearing the same shape.

- **`selection.ts:47`** tests `isInRange` against the snapshot of reachable tiles
  taken when the unit was selected, not against current state. Fine today; phase
  6's confirmation step is where it gets interesting.
- **`renderer.ts` unit meshes** are built once with no add/remove
  (`renderer.ts:100`), which is 7c and is why nothing can die yet.
