# Victory or Death — Sidequests

Work that is wanted but is not a phase: small, self-contained, and orderable
however it suits. Forward-looking only, exactly like
[`roadmap.md`](roadmap.md) — when one of these ships it moves into
[`architecture.md`](architecture.md) and is deleted from here. Nothing below
describes current behaviour.

---

## S2 — ⬜ The camera stays on the board

**Limits, not automation.** The same shape as the tilt clamp already in
`renderer.ts`: the player still drives the camera, and the camera simply cannot
be driven somewhere useless. Two bounds, one per remaining freedom.

- **Zoom is clamped at both ends.** Furthest out is *the whole board just fits*
  — past that is dead space around a shrinking board and nothing gained.
  Closest in is a taste call, and the only one here.
- **Pan is clamped to the board.** The viewport never shows past an edge. The
  standard form falls straight out: per axis,
  `maxPan = max(0, (boardExtent − viewportExtent) / 2)`. ⚠️ Note what that gives
  for free — at full zoom-out the viewport is larger than the board, the
  expression goes to zero, and the board is **centred with no pan available at
  all**. Centring needs no separate rule; it is the clamp at its limit.

⚠️ **Panning is unlimited today and nothing says so.** `attachControl` is called
and only the *wheel* input was ever removed, so right-drag and ctrl-drag pan the
camera's **target** as far as you like. That is the freedom this bounds.

⚠️ **The view-matrix projection is still needed, but for a different job.** How
much board there is to pan across depends on where the camera is: orbit a square
board through 45° and its projected width grows by √2, with `beta` foreshortening
the depth on top. So `boardExtent` has to be measured, not derived from the grid
— `Vector3.TransformCoordinates(corner, camera.getViewMatrix())` over the
board's eight corners, whose x and y *are* the orthographic frustum's own axes.
The difference from the version this replaces is that the result is a **bound**
rather than the value the camera is forced to. The player keeps the wheel.

⚠️ **`ORTHO_ZOOM_PADDING = 0.7` is what this replaces, and it is not a design
choice.** It is slack, sized so the worst angle does not clip — which means
every other angle leaves viewport unused. Measuring the extent retires it.

Include the slab's bottom corners in the measurement: it hangs below the board
and is part of the silhouette, so leaving it out clips it at shallow angles,
where it is most of what you can see.

`MIN_ZOOM` is what the computed floor replaces. `MAX_ZOOM` and `ZOOM_PER_NOTCH`
survive unchanged — this bounds the wheel rather than removing it, so the notch
size and the zoom-in limit are still exactly what they were.

⚠️ **Nothing here can have a test.** `GameCanvas.test.tsx` mocks the renderer so
Babylon never loads, which is deliberate and is not going to change. `/run-app`
is the whole check, and the specific thing to drive is **orbit to several angles
at each zoom extreme** — a screenshot at the default angle passes while clipping
at every other, which is the failure this is meant to prevent.

### ⚠️ S5 turned this from polish into playability

Twenty by twenty shipped, and the whole-board view it produces draws a piece at
about half the size phase 8 tuned it to. On screen the ranks are slivers. So
this is no longer about wasted viewport:

- **The default zoom has to be closer than the zoom-out floor.** They are two
  numbers, not one. The floor is *the whole board just fits*, which is a
  planning view; the default is whatever makes a unit legible, which is nearer.
- **Which is exactly what Advance Wars does.** Re-Boot Camp puts the whole map
  on the right stick pulled back and a single unit on it pushed forward — the
  board is something you zoom *out* to consult, not the view you play from.
- **Panning stops being a nicety** for the same reason: once the default view is
  smaller than the board, moving around it is how you play at all.

Open: how far *in* zoom should go, where the default sits between the two, and
how much margin to leave at full zoom-out.
