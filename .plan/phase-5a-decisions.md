# Phase 5a — settled decisions

Scratch doc. Everything here belongs in `architecture.md` once 5a lands; absorb
it and delete this file, the way `server-sidequest.md` went.

All seven steps are done. 5a is complete; what remains is absorbing this file
into `architecture.md` and deleting it.

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

**The callback alone relocates rather than removes.** The pair
`selectionRef.current = next; showSelection(…)` appears at three sites today —
the optimistic set and the rollback in `submitCommand` (`GameCanvas.tsx:54`,
`:62`), and the click commit (`:95`) — and forgetting the push at any of them
desyncs the highlight silently. So every selection write funnels through one
`applySelection(next)` inside the hook: set the ref, fire the callback. The
pairing then exists in one place instead of being a rule to remember at three.
That helper, not the callback by itself, is what makes the extraction simpler
rather than merely rearranged.

**The canvas's callback must read `rendererRef.current` at call time**, never
close over a renderer captured earlier. Not style: `submitCommand` today
captures the renderer before its await (`GameCanvas.tsx:49`), so a rejection
that lands after the canvas unmounted pushes the rollback into a *disposed*
renderer — and `setMovementRangeTiles` rebuilds vertex buffers against a
released engine. Reachable now by leaving the match while a submit is in
flight; step 4 adds match→match navigation to the ways there. (Read from the
code, not reproduced in a browser.) An at-call-time read turns the same window
into a guarded no-op, which is what the architecture doc's "the push guards a
null renderer itself" is quietly relying on.

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

Stated as the delta it is, rather than "nothing is lost": a click in that
window changes from *silently refused* to *submitted normally*. The window is
sub-frame — the button and the canvas paint in the same commit and the effect
runs right after — and the submit path works without a renderer: the push
guards null, the animation is skipped, the state still lands. Unobservable in
practice, but 5a's zero-delta claim is load-bearing, so the exception gets
named instead of rounded to zero.

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

### ✅ Resolved and fixed (step 4): `server` *could* change under a mounted `GameCanvas`

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

**Fix it in `MatchRoute`, not in the canvas.** The plan here was two lines at
the top of the connect effect (`setServer(null); setFailure(null)`), and the
implementation deviated for cause: the repo's own `react-hooks` lint forbids
synchronous setState in an effect body, and React's guidance for "reset state
when a prop changes" is a key. So `MatchRoute` splits into a param-reading
shell and a `MatchConnection key={matchId}` — a param change remounts the
connection, resetting *all* of its state, where the two lines would have
missed `connection` and left a stale "reconnecting…" crossing matches.

A match change then shows "Connecting…", which is correct, and `server` can no
longer change under a mounted canvas — now by construction rather than by
reset ordering — so **the renderer stays a `ref`**.

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

Step 3 then dissolves the read-source question for the *push* entirely: with
the selected unit's `position` captured on the union member, `showSelection`
becomes a projection of the selection alone — no `state` parameter, no source
to choose between. Only `handleTileClick` keeps reading the authority.

## Proposed order

Seven separately verifiable steps:

0. ✅ ~~**Turn on `strict`.**~~ Measured at zero errors across every package, so
   it was a flag flip rather than the risky increment it was parked as — see 5a
   in `architecture.md`. First, so the code the later steps write is written
   under it rather than retrofitted.
1. ✅ ~~**`net/gameServer.ts` tests + the `applyUpdate` simplification.**~~
   Independent of the refactor, so they are a net the refactor cannot
   invalidate. The poll loop reschedules from an async callback, so the tests
   use `vi.advanceTimersByTimeAsync`, not the sync form. `visibilitychange`
   stays out of reach until step 5 adds the DOM harness. One test pins today's
   422-as-transport-failure behaviour on purpose; step 2 flips that assertion
   in the same commit that fixes it.

   ⚠️ **Do not assert on the text of a transport failure.** `HttpError`'s
   message is built from the status code today (`server returned 400`), and the
   server now sends a real reason in the body that the client will start reading
   — see the 422 section below. Assert the `kind` and that `ok` is false; a test
   pinned to today's wording would have to be rewritten by a change that is
   otherwise additive.
2. ✅ ~~**Teach the client about 422.**~~ The one step of 5a that changed
   behaviour: a refused move now shows the server's reason instead of *"server
   returned 422"*, and no longer raises the reconnecting banner. Landed after
   step 1's tests, which flipped their pinned assertion in the same commit.

   The guardrail held: `rejected` stayed out of the vocabulary the connect
   path consumes. `ConnectResult` and `MatchRoute`'s failure UI are a two-case
   union — `notFound` gets a way back, `unreachable` gets Retry — and
   `connectGameServer` maps `HttpError.kind` straight into it
   (`gameServer.ts:45`). Widening `FailureKind` would have flowed `rejected`
   into a component with no UI for it. The rejection became a separate error
   type instead (`RejectedError`), which also left the connect path literally
   untouched: a stray 422 there falls through `instanceof HttpError` to
   `unreachable`, which is what a broken server is.
3. ✅ ~~**`SelectionState` becomes a union, and the member carries
   `position`**~~ — captured at selection time exactly as `reachableTiles`
   already is, so the type stopped being half snapshot, half lookup, and the
   highlight push became a projection of the selection with no `state`
   parameter (see above). On invariant 6: selection is ephemeral UI state
   (invariant 7), not `GameState`, so snapshotting what it previews takes
   nothing from "derive the rest" — and the parked `selection.ts:47` note had
   already committed the type to snapshot semantics, which phase 6's
   confirmation step needs anyway. The two identical selection literals
   collapsed into one `trySelect` constructor, which also turned out to *be*
   the "switch or deselect" branch — the tail of `handleTileClick` is now one
   call. The four record-shape assertions were updated as counted; the other
   seven tests survived untouched.
4. ✅ ~~**Fix `MatchRoute`'s stale server**~~ — its own commit, and a real bug
   fix rather than refactor. Landed as a `key={matchId}` remount rather than
   the planned two-line reset — see the resolved ⚠️ above for why. Before the
   extraction, because it is what lets the renderer stay a `ref`. The Retry
   handler's own `setFailure(null)` stays: batched with `setAttempt`, it is
   what paints "Connecting…" in the click's own render, where the effect
   re-run fires only after a frame of stale failure UI. Redundant-looking,
   not redundant.
5. ✅ ~~**Pull the DOM harness forward from 5b**~~ — `happy-dom` and
   `@testing-library/react`, plus the `visibilitychange` tests that finish
   `net/gameServer.ts`'s coverage. Here rather than 5b because step 6 carries
   5a's riskiest hazard — the `onEvents` wipe above — and nothing DOM-less can
   see it: every client test was `handleTileClick`, so the extraction could
   have broken the rejection UI with the gate green, and "a 5a regression is
   necessarily the refactor" only helps if the regression is detectable. The
   environment is `happy-dom` in `vite.config.ts`, whose `defineConfig` now
   comes from `vitest/config` so the `test` key is typed. The three
   `typeof document !== 'undefined'` guards in `gameServer.ts` came out with
   it — their only beneficiary was a DOM-less test run, which no longer
   exists. `document.hidden` is shadowed per-test with `defineProperty` and
   the shadow deleted in `afterEach`.
6. ✅ ~~**Extract `useGameSession`**~~ — render replica, rejection state,
   in-flight guard, `submitCommand`, the tile-click handler, subscription, and
   the one `applySelection` write path (decision 1). The canvas keeps the
   renderer effect and the JSX, imports neither `handleTileClick` nor
   `initialSelectionState`, and knows three things: a canvas ref, the renderer
   lifecycle, and how to draw a selection. Landed with 8 hook tests against a
   fake in-memory `GameServer`, including one that re-renders with fresh
   callback identities and asserts the rejection survives — verified to fail
   against a subscription that depends on the callbacks, which is the exact
   regression it guards. The hook exposes `endTurn` rather than a raw
   `submitCommand`, so `Command` construction never leaves the session.

## Parked questions, unrelated to the three above

### ✅ Command rejections answer 422 — both halves done

**The server half:** `POST /commands` answers **422** with `{ error: reason }`
when the rules refuse a well-formed command, keeping 400 for a body that was
never a command and 404 for a missing match. `MatchStore.submit` returns
`CommandResult | null`, so `ok: false` means exactly one thing and each status
is a one-line mapping.

**The client half landed as step 2.** `client/net/api.ts` classifies a 422 as
`RejectedError` and reads the `ErrorResponse` body of every non-2xx, so errors
carry the server's wording; `gameServer.submit` returns a rejection as
`{ ok: false, reason }` without `setStatus('retrying')`. That retired the
conflation this section used to describe: a transport failure and a rule
rejection no longer arrive at the UI wearing the same shape.

- **`selection.ts:47`** tests `isInRange` against the snapshot of reachable tiles
  taken when the unit was selected, not against current state. Fine today; phase
  6's confirmation step is where it gets interesting.
- **`renderer.ts` unit meshes** are built once with no add/remove
  (`renderer.ts:100`), which is 7c and is why nothing can die yet.
