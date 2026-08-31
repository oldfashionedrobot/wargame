# Phase 5a — settled decisions

Scratch doc. Everything here belongs in `architecture.md` once 5a lands; absorb
it and delete this file, the way `server-sidequest.md` went.

Nothing below is built. The repo is at the state 5a starts from.

## The three decisions the doc asked for

### 1. How does the canvas learn the selection? → **the hook returns it as state**

`useGameSession` owns the selection and returns it; `GameCanvas` pushes it to
the renderer in an effect. The rejected alternative was an `onSelectionChange`
callback, which is the zero-delta option because today's three `showSelection`
calls are already imperative and synchronous.

Chosen because it is idiomatic, and because it makes the hook assertable from a
test without a renderer — which is what 5b needs when hook tests arrive.

Costs, both accepted: a re-render per selection change (cheap — the canvas
element is untouched, only the turn and rejection spans re-render), and the
highlight push is deferred by one commit, which Babylon's own render loop makes
invisible.

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

### A fourth decision: the click handler has to be re-registered

Decision 1 makes the selection React state, so `clickTile` closes over it and
changes identity on every selection change. But the renderer captures the click
handler **once**, in the effect — which is exactly why the selection is a `ref`
today (`GameCanvas.tsx:31`, read synchronously at `:90`).

So either the canvas re-registers the handler in an effect, or the hook keeps a
`selectionRef` and we are back to two copies of one thing.

**Re-register.** It is safe: `onTileClick` in `renderer.ts:133` *sets*
`clickHandler` rather than adding to a list, so re-running the effect replaces
the handler instead of accumulating listeners. Verified by reading it, not
assumed.

### The renderer moves from a ref to state

`rendererRef.current` is not reactive, so neither the re-registration effect nor
the selection-push effect has any way to wake when the renderer appears.
Declaration order happens to make it work today — the renderer effect is
declared before them — but that is a fragile invariant to rest three effects on.

`useState<GameRenderer | null>` makes all three honestly dependent and removes
the ordering subtlety entirely.

⚠️ **Worth confirming before committing to this.** `server` appears never to
change while `GameCanvas` is mounted: `MatchRoute` renders the failure UI or
`Connecting…` rather than the canvas whenever it is between servers, so a new
server implies a remount. If that holds, renderer-as-state is solving a
hypothetical. It is still the better shape, but it should be chosen knowingly.

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

### Two honest behaviour deltas

5a is billed as no behaviour change. It is *nearly* that, and the two exceptions
should be named rather than discovered:

- **The highlight re-pushes on every authoritative update**, not only on
  selection changes, because `showSelection` derives the selected unit's
  *position* from state — so `state` has to be in the effect's deps. Arguably
  more correct (the highlight follows the unit), but it is a delta.
- **The push reads the render replica**, not `server.getState()` as the three
  imperative call sites do today. They agree now. 5b deliberately makes the
  replica lag during animation, and at that point the replica is the right
  source for a highlight — so this is settled here rather than rediscovered.

⚠️ `clickTile` must keep reading `server.getState()` (invariant 1). Tempting to
use `state` since the hook has it in scope; that would be a real regression —
acting on a board a beat old.

## Proposed order

Five separately verifiable steps:

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
4. **Extract `useGameSession`.**

## Parked questions, unrelated to the three above

### ✅ Command rejections answer 422 — server done, client owed

**The server half is built.** `POST /commands` now answers **422** with
`{ error: reason }` when the rules refuse a well-formed command, keeping 400 for
a body that was never a command and 404 for a missing match.
`MatchStore.submit` returns `CommandResult | null`, so `ok: false` means exactly
one thing and each status is a one-line mapping.

**The client half is step 2 below, and it is owed rather than optional.** Until
it lands the game is visibly worse than before: `client/net/http.ts:37` throws on
any non-2xx that is not 404, so a rejected move surfaces as *"rejected: server
returned 422"* and falsely flips the UI to "reconnecting…". Two small edits, and
`GameCanvas` does not change at all because `submit()` still returns
`CommandResult`:

- **`client/net/http.ts`** — add `'rejected'` to `FailureKind`, and on a 4xx read
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
