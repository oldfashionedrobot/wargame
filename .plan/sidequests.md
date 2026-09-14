# Victory or Death — Sidequests

Work that is wanted but is not a phase: small, self-contained, and orderable
however it suits. Forward-looking only, exactly like
[`roadmap.md`](roadmap.md) — when one of these ships it moves into
[`architecture.md`](architecture.md) and is deleted from here. Nothing below
describes current behaviour.

---

## S7 — The route as an arrow

The route is drawn today as a **tint on every tile of the path**. Advance Wars
draws a line with a head on it, and that reads better: a tint says *these tiles*,
an arrow says *this way, ending here*. ⚠️ Now that the route is pinned rather
than following the pointer, it is on screen long enough to be worth drawing well.

**The seam is already right.** `setRoute(path)` takes the path *in order* —
which a tint does not need and an arrow does — so this swaps an implementation
and touches nothing outside the renderer.

`tileOverlay.ts` builds one merged mesh of per-tile quads. The arrow is that
module with **UVs** added, and orientation is a **cyclic shift of the four UV
corners** rather than a per-tile transform, so every quad stays axis-aligned in
a single mesh and the draw-call story is unchanged.

Four shapes, because a path never branches and no tile has three connections:

| position in path | connections | piece |
|---|---|---|
| first, length > 1 | one, toward `next` | tail |
| middle, opposite | two | straight |
| middle, perpendicular | two | corner |
| last | one, toward `prev` | head |
| length 1 | none | nothing drawn |

⚠️ The last row is *standing still*, and AW draws nothing for it either — so the
case that looks like it needs a fifth piece needs none.

Draw the atlas into a `DynamicTexture` with canvas 2D at startup: no asset file,
no pipeline, and the colour stays a tunable constant beside `ROUTE_COLOR`.

⚠️ **It also retires a blemish rather than inheriting one.** `SELECTED_HEIGHT`
(0.025) and `HOVER_HEIGHT` (0.02) both sit above `ROUTE_HEIGHT` (0.018), so
against a full-tile tint the hover cuts a hole in the route and the selected
yellow covers its first tile. A thin arrow with alpha around it overlaps neither.

Known and not new: the arrow **steps** rather than ramps across a hill, and
foreshortens at shallow camera angles. Every tile overlay already does both.

⚠️ This is also the substrate **manual routing** wants — a pinned, re-pinnable
route with a drawn path is what waypoints would hang off.
