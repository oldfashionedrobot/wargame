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

**Re-register.** It is safe: `onTileClick` in `renderer.ts:129` *sets*
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

Three separately verifiable steps:

1. **`net/gameServer.ts` tests + the `applyUpdate` simplification.** Independent
   of the refactor, so they are a net the refactor cannot invalidate. Note the
   poll loop reschedules from an async callback, so the tests need
   `vi.advanceTimersByTimeAsync`, not the sync form. `visibilitychange` stays
   out of reach until 5b adds a DOM.
2. **`SelectionState` becomes a union**, plus the four assertions in
   `selection.test.ts` that touch the record shape (lines 29, 30, 82, 93 —
   the doc's count is exact; the other seven tests survive untouched).
3. **Extract `useGameSession`.**

## Parked questions, unrelated to the three above

### Command rejections answer 200 — deferred until after phase 5

Decided to fix, deliberately not now. Both ends of one problem:

- **`http.ts:119`** returns 200 for a rejected command, by documented decision
  (*"rejection is an answer and not a transport failure"*). Candidate: 422,
  leaving 400 to mean what it already means here — the body was not a parseable
  command.
- **`gameServer.ts:127`** synthesises a transport failure into
  `{ ok: false, reason }`, the same shape a rejection arrives in, so the UI
  renders "could not reach the server" and "unit has already acted" identically.

They have to move together. `client/net/http.ts:33` throws on any non-2xx that
is not 404, so a server-only change would flip the UI to "reconnecting…" and
replace the real reason with "server returned 422". The client half lands in
`gameServer.ts` — the file 5a puts under test — which is the other reason to
sequence it after.

**The server half is now done.** Every non-2xx carries `{ error: string }`
(`ErrorResponse` in `shared/protocol.ts`). The client still ignores it —
`http.ts` builds its message from the status code — so `HttpError` should learn
to read the body and carry the server's wording. That is a prerequisite for the
422 change, and it is worth doing on its own: today a 400 surfaces as "server
returned 400" when the server already said "not a valid command".

Separately and much smaller: **`match.ts:114`** returns
`{ ok: false, reason: 'no such match' }` where `snapshot` and `since` both
signal not-found with `null`. Unreachable over HTTP — `http.ts:112` pre-reads
and 404s first — so this is a `MatchStore` contract inconsistency, not a live
bug. Folding it into the above makes `CommandResult.ok === false` mean exactly
one thing: the authority refused a well-formed command.
- **`selection.ts:47`** tests `isInRange` against the snapshot of reachable tiles
  taken when the unit was selected, not against current state. Fine today; phase
  6's confirmation step is where it gets interesting.
- **`renderer.ts` unit meshes** are built once with no add/remove
  (`renderer.ts:98`), which is 7c and is why nothing can die yet.
