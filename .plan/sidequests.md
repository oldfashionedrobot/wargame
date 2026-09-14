# Victory or Death — Sidequests

Work that is wanted but is not a phase: small, self-contained, and orderable
however it suits. Forward-looking only, exactly like
[`roadmap.md`](roadmap.md) — when one of these ships it moves into
[`architecture.md`](architecture.md) and is deleted from here. Nothing below
describes current behaviour.

---

## S2 — ⬜ The camera fits the board

No zoom control. The board fills the viewport and its centre stays at the
viewport's centre, whatever the orbit is doing.

Removes the wheel listener, the zoom factor, and `MIN_ZOOM` / `MAX_ZOOM` /
`ZOOM_PER_NOTCH`. What replaces them is the interesting part:

- ⚠️ **Fitting is not a function of the grid's size.** How large the board draws
  depends on where the camera is: orbit a square board through 45° and its
  projected width grows by √2, and `beta` foreshortens its depth on top of that.
  A constant derived from `max(width, height)` fits exactly one angle and either
  wastes the viewport or clips the corners at every other — which is what
  `ORTHO_ZOOM_PADDING` at 0.7 is really compensating for.
- **The exact answer is the view matrix.**
  `Vector3.TransformCoordinates(corner, camera.getViewMatrix())` gives a point
  in view space, whose x and y *are* the orthographic frustum's own axes. Fit to
  the board's eight corners — four at ground level, four at the slab's bottom —
  and the fit is correct at every angle by construction rather than by a
  fudge factor. Recomputed when the view matrix changes and on resize; eight
  points is nothing.
- **Centring falls out of keeping the bounds symmetric.** The camera targets the
  origin and `tileToWorld` centres the board there, so the board's centre
  projects to view-space `(0, 0)` — which is the viewport's centre exactly when
  `orthoLeft = -orthoRight` and `orthoTop = -orthoBottom`. So fit to
  `max(|x|)` and `max(|y|)` rather than to the bounding box: a box fit would
  centre the board's *extent*, and those are not the same point once the slab
  hangs off one side of it.
- ⚠️ **Panning has to go or the lock is a lie.** `ArcRotateCamera` pans on
  right-drag and ctrl-drag by moving its **target**, and a moved target is
  precisely the board leaving the centre. `panningSensibility = 0`.
- ⚠️ **Include the slab in the fit.** It hangs below the board and is part of its
  silhouette, so leaving it out clips it at shallow angles — where it is most of
  what you can see. Including it costs headroom at the top, which symmetric
  bounds spend as padding rather than as drift.

Open: how much padding, if any, beyond a tight fit.

## S4 — ⬜ A turn is a budget of actions

**`ACTIONS_PER_TURN`, a named constant, and the turn ends itself when it is
spent.** At 1 the game is chess: one unit, one command, over to you. At the
roster size it is what plays today, minus the button. Everything between is
reachable by editing one number, which is the point — the right value is a thing
to find by playing, not to argue about now.

⚠️ **`hasActed` stays**, and is what makes this nearly free. It already records
exactly the thing a budget needs to count.

### The whole mechanism

```
spent(state) = units owned by currentTurn with hasActed
turn is over  when  spent >= min(ACTIONS_PER_TURN, that player's unit count)
```

⚠️ The `min` is not defensive padding. A player with fewer units than the budget
could never reach it, and their turn would never end — so "everyone has acted"
has to end a turn as surely as "the budget is gone". Both are the same rule
written once.

Resolution then appends `turnEnded` to the events a move already produces, when
that move was the one that spent the turn.

⚠️ **Two events, not one compound event**, for the reason invariant 9 already
gives: each is independently applicable and carries an absolute value, and
`turnEnded` already names `nextPlayer` rather than saying "the turn changed". It
is the shape the roadmap prescribes for a successful charge — `unitDied` plus
`unitMoved` — arriving a phase early.

⚠️ **No fold is needed to count.** A move sets `hasActed` on exactly one unit
that did not have it, so the count after is the count before plus one.
Resolution can decide without applying anything to a copy of the state first.

### Where it lives

A `turns.ts` in `shared/`, holding the constant, the two predicates above, and
`nextPlayer` — which is in `endTurn.ts` today only because that was the one
thing that needed it. Turn order and turn length are the same subject and
currently live in two places for no reason.

### What it touches

Far less than the count of files that mention `hasActed` suggests. `resolveMove`
gains a branch, `matchState` is untouched, `applyEvents` is untouched, the
client's whole interaction is untouched. The pipeline, the log, replay, the
`seq` cursor and polling all stay exactly as they are.

### Open

- **Does End Turn survive, and may a player pass?** At a budget above one it is
  wanted: ending early without spending every action is a real choice. At a
  budget of one it *is* a pass, and a pass is a different game — chess has none.
  ⚠️ Note that passing is already expressible without a command: a single-element
  path plus a facing is legal at cost 0 and spends the unit's turn, so a player
  can always decline to move meaningfully. Which means the button is a
  convenience, not a capability, and can go without removing anything.
- ⚠️ **The budget interacts with the two original mechanics.** At 1, two units
  can never converge before the opponent answers, so flanking telegraphs and
  charge loses its setup — and facing and charge are the only things in this
  game with no reference behaviour to check against. That is not an argument
  against a low budget; it is an argument for settling the number **before**
  phase 9 tunes anything against it.
