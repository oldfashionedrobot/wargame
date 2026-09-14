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

Open: how far *in* zoom should go, and how much margin to leave at full zoom-out.

## S5 — ⬜ Twenty by twenty

Boards go to **20 × 20**, which is what Advance Wars' own competitive play
settles on and so is the model rather than a number picked to have one. Ten by
ten was the latter. Boards stay rectangular; the slab already scales to
`gridWidth × gridHeight`, so what changes is the assertion in `maps.test.ts`.

For reference, since it is why 20 and not something else:

| | |
|---|---|
| AW1 / AW2 design room (GBA) | **30 × 20** maximum |
| Dual Strike (DS) | **5 × 5** to **30 × 30** |
| AWBW competitive 1v1 | **~20 × 20** typical; **8 × 8** the accepted floor |

### What it actually changes

```
area        100 tiles -> 400 tiles (4x)
occupancy   16 units of 100 = 16%  ->  16 of 400 = 4%
the rank    cols 1..8 (1 spare each side)  ->  cols 6..13 (6 spare each side)
approach    9 rows apart -> 19; both sides advancing closes it in 1.1 -> 2.4 turns
```

⚠️ **The approach is a non-issue and the density is the real one.** Doubling the
distance costs about a turn and a half, which is nothing. Quartering the
occupancy is what will be felt: 4% is a lot of empty green, and Advance Wars
fills that space with *production* — properties to capture and bases turning out
units all game. Ours fields eight and nothing ever arrives.

⚠️ **Which makes army size the dial to reach for if it plays empty**, not board
size again. Noting it here so the second attempt is not another resize.

### Redrawn, not magnified

⚠️ **Doubling every tile is the wrong instinct and would change what the terrain
means.** A river scaled 2× is two tiles wide, which is a different obstacle
needing a two-lane bridge; a road scaled 2× is a two-lane road. The boards need
genuinely more *features* — roughly four times the woods, water and rock — or
400 tiles will read as a field with a few things on it.

- The deployment rule is unchanged but moves with the rank: **columns 6–13 of
  rows 0 and 19** must stay clear of river and mountain, since `wheels` cannot
  enter either.
- ⚠️ **`two-bridges` gets easier.** At ten wide, a river could only leave the
  board through its east and west edges or stop short — six spare columns each
  side of the rank is room for a river to reach the north and south edges
  outside the deployment span.

### What else moves, which is more than the size assertion

⚠️ **`match.test.ts` and `http.test.ts` hardcode board coordinates**, and this
would be the **third** content change to break them — once when the army left
the maps, once at 10×10, now again. About ten sites: `blue-1` is at column 1
today because a rank of eight centred on ten leaves one spare each side, and at
twenty it is column 6. `red-1` goes from `(8,9)` to `(13,19)`.

⚠️ **The fix is to stop hardcoding them**, and the cheapest place to do it is
**S6**, which already has to touch both files. Derive the two positions from
`createMatchState(getMap('classic'))` once at the top, and S5 costs nothing
there at all — while the next change to the army or the board costs nothing
either. Doing S5 first means editing the same fixtures twice.

⚠️ **The dev database needs wiping again**, for the reason S1 recorded: map ids
are immutable, and redrawing terrain under an unchanged id retroactively changes
what every stored match claims to have been played on. Same escape as before —
`packages/server/vod.db` and its `-wal`/`-shm` siblings, all gitignored and
recreated by `migrate()` at boot.

⚠️ **`maps.test.ts`'s crossability threshold scales with the board.** It asserts
more than half the board is reachable per movement type, which is 200 tiles at
20 × 20 rather than 50. A board with a large lake or a long range of mountains
could now fail it while looking perfectly playable — worth knowing it is a real
constraint on the redraw rather than a formality.

⚠️ **Four hundred tiles is four times the meshes to instantiate before merging.**
Draw calls do not move — merging is by material and the palette is unchanged —
but `createTerrainMesh` builds every ground model and every prop as a loose copy
first, and a wood is five trees a tile. Worth measuring the scene build rather
than assuming; it is a one-time cost on a load that is already async, so the
question is whether it is visible, not whether it is free.

### ⚠️ The interaction worth catching before it bites

**Phase 8 sized the pieces to read on a 10 × 10 board seen whole.** The camera
fits `max(width, height)`, so at 20 × 20 the same view is twice as far out and
every piece draws at **half its current size on screen** — which is most of the
readability that pass bought, given away.

So S5 and S2 are one job in practice. Either the default view stops being the
whole board, or the zoom limits are what make it playable, or `PIECE_SCALE` goes
up again. Worth deciding deliberately rather than discovering in a screenshot.
