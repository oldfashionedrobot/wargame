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
