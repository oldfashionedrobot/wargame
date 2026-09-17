# Victory or Death — Roadmap and design

Forward-looking only: mechanics that are specified but not built, and the
order they are planned in. What the code does *today* is in
[`architecture.md`](architecture.md); nothing here describes current
behaviour.

---

## Combat ✅ — shipped

The design that was here described the mechanics of phases 9, 9.9 and 10 before
they existed: the matchup matrix and why a pair of scalars cannot express a
triangle, facing and what it is allowed to touch, the action panel, the damage
preview, the event shape a client is told, and charge. All of it is built, so all
of it now lives in [`architecture.md`](architecture.md) under *Combat*, *Facing*,
*Charge*, *The combat cutaway* and *Client*.

⚠️ **It was not merely duplicated — parts of it had gone false**, which is the
argument for the rule that shipped work leaves this file. The *Facing* section
still described charge as `margin = targetHP − threshold` against a luck roll,
which exponential decay replaced; still specified the directional term as
**additive** when it shipped as a multiplier; and still claimed `charge?` was a
field on `UnitType`, where capability is a missing row in `CHARGE_THRESHOLD`. A
reader would have been misled about the formula, the term and where the rule
lives.

**What stayed**, because it is genuinely unbuilt: the tuning below.

### Tuning

The surface is `BASE_DAMAGE`, `CHARGE_THRESHOLD` and `CHARGE_REPEL`, plus the
loose dials beside them: `FLANK_MULTIPLIER`, `REAR_MULTIPLIER`, `LUCK_MAX`,
`CHARGE_HALF_LIFE`, and the repel's miss-scaling.

⚠️ **This used to open by counting them, and the count is gone.** The total is a
product of how many unit types exist, so every table's size moves together and
the figure was stale the moment anything was added — while never carrying the
point, which is *which* dials there are.

#### The first cut

⚠️ **Written down to be argued with, not because they were right.** Nothing had
been played when these were chosen. They existed so the harness had something to
print and so tuning could start from a position rather than a blank table.

⚠️ **Play has since moved three things, and only one was a number here.**
`BASE_DAMAGE`'s infantry and cavalry rows went up fifteen — below. The other two
were both about artillery and neither was a dial: its minimum range went from
two to three, and `slow` was added, which is a flag. Worth keeping from that:
the first cut's *shape* held, and what it got wrong it got wrong as a **rule**
rather than as a value.

`BASE_DAMAGE`, attacker down the side, as a percentage of a full-health target:

| | infantry | cavalry | artillery |
|---|---|---|---|
| **infantry** | 45 | 50 | 60 |
| **cavalry** | 30 | 35 | 40 |
| **artillery** | 75 | 60 | 40 |

⚠️ **Infantry and cavalry were raised fifteen, to widen the *first-strike*
advantage.** There is no dial for "counters hit softer" and there should not be:
both sides use one formula, and the whole asymmetry is that a counter reads the
defender's **post-damage** health, exactly as AW does. That makes the table
non-linear in the useful direction — hit harder, and the defender loses more
bands before answering, so the counter shrinks as the attack grows. Past a base
of about 50 it shrinks in absolute terms.

An infantry exchange ran **27 against 21** at the old numbers, a ratio of 1.29
and barely a first strike; it is 1.67 now, and the table spans **1.29 to 2.48**
against AW2's own 1.11 to 5.06.

⚠️ **Artillery's row was deliberately left alone.** At 75 a gun already killed
infantry in two hits, so raising it bought lethality where the matchup was
already decided rather than in the flat exchanges this was for — and the ratio it
would have added is academic, since a defender that dies to the first blow never
answers at all.

⚠️ **And not raised further**, which would have reached AW's ceiling: terrain
stops changing the hit count in a fourth matchup, and units stop lingering at the
health where a charge is a good bet. AW affords 5:1 with far more unit types to
spread a triangle across than three.

⚠️ **An earlier cut ran 40–90 and the harness killed it.** Everything died in two
hits, which flattened three things at once: terrain became a rounding error (a
four-star mountain bought one extra blow or none), the matchup numbers
produced two distinct outcomes, and luck moved nothing. Worse, it starved phase
10 — `CHARGE_THRESHOLD` wants infantry at ≤25 health, and a unit went 100 → 45 →
dead without ever passing through the band where a charge is legal.

**The fix was spread, not shape.** AW's nine analogous cells run 12 to 90:

| AW2 | Infantry | Recon | Artillery |
|---|---|---|---|
| **Infantry** | 55 | 12 | 15 |
| **Recon** | 70 | 35 | 45 |
| **Artillery** | 90 | 80 | 75 |

⚠️ **Copy the range, never the shape.** AW's 12 and 15 encode *armour
penetration* — a rifle cannot hurt a vehicle. There is no armour in a
horse-and-musket war and musketry into cavalry was famously lethal, so importing
that 12 would say infantry cannot hurt horses and leave cavalry riding around
untouchable. What transfers is that the losing edges must genuinely lose.

⚠️ **Cavalry is bad in every column deliberately** — carbines from horseback —
because its identity is in the charge table, and a cavalry that shoots well has
no reason to close. It is the worst shooter in every column by a clear margin,
which is what makes closing the point. ⚠️ A hits-to-kill figure stood here and
went stale with the first retune — `scripts/matchups.ts` prints the current
grid, and a number copied out of it is a number that has to be copied again.

`CHARGE_THRESHOLD`, charger down the side. Target HP at or below this succeeds
without luck; artillery has no row:

| | infantry | cavalry | artillery |
|---|---|---|---|
| **cavalry** | 25 | 25 | 60 |
| **infantry** | 20 | 15 | 45 |

`CHARGE_REPEL`, keyed by **who is being charged** — the flat cost of a failed
charge, before the overshoot term adds up to 9 more:

| infantry | cavalry | artillery |
|---|---|---|
| 10 | 5 | 8 |

⚠️ **This table was missing from the first cut entirely** — every other one was
here and this was not, so the first tuning run would have had nothing to print
for it. The ordering is the sentence the design already gives: infantry with
bayonets fixed is what cavalry breaks on, a battery firing canister hurts but is
the least prepared of the three to be reached, and cavalry receiving a charge is
simply being run into. ⚠️ Artillery at 20 is deliberately **well under its
ranged 60** — borrowing that number would assert a battery is as dangerous at
contact as at reach, which is the opposite of what `min: 3` exists to say.

⚠️ **The level was picked against the crossover, not by feel.** Charging is a
losing bet below roughly these odds and a winning one above:

| | into infantry | into cavalry | into artillery |
|---|---|---|---|
| **cavalry charges** | 19% | 11% | 16% |
| **infantry charges** | 20% | 14% | 12% |

That puts charge where it belongs — a **finisher you can reach for**, not an
opener and not a last resort — and it is the property to re-measure first when
these numbers move. Doubling the table pushes every crossover right and makes
charging rare; halving it makes charging nearly free.

⚠️ **The multiplicative drafts all pushed this to 40%+**, which would have made a
threshold table a lot of tuning for something seldom done. That is the
symptom to watch for.

`FLANK_MULTIPLIER 1.5`, `REAR_MULTIPLIER 2`, `REPEL_DIVISOR 10`, `luckMax 9` — the
last matching AW exactly, since `baseDamage` is a percentage in both schemes.

⚠️ **Measured, not predicted: `cavalry → artillery 60` saturates at the flank.**
With the multipliers wired, that row reads 16/31/63/100/100/100 head-on,
63/100/100/… from the flank, and 100% at every health from the rear. So flank and
rear differ only against a full-health battery, and the rear multiplier does
nothing in the row it was most meant for. ⚠️ The intent was *60 / 90 /
automatic* — cavalry into the rear of a battery as the signature moment — and
what arrived is *automatic / automatic*, because 60 × 1.5 is already 90 and the
health scale only runs to 100.

**Three ways out, none taken yet, because nothing has been played:** lower the
base so the multipliers have room (40 gives roughly 3 / 22 / 63 at full health);
or accept that closing with a battery is simply decisive from any side and let
the *threat* be the mechanic rather than the angle; or cap the effective
threshold below 100 so a charge is never automatic, which would also touch the
signature moment deliberately rather than by accident. ⚠️ The same shape is worth
checking in `infantry → artillery 45`, which saturates one column later.

⚠️ **The triangle closes in the charge table, not the damage one.** Cavalry
loses the shooting exchange with artillery (55 out against 75 back), so it has
to close; `cavalry→artillery 60` then runs 60 / 90 / automatic across head-on,
flank and rear, which keeps all three directions meaningful. Against infantry it
runs 25 / 37 / 50 — a frontal charge needs a nearly-dead target, which is what
"infantry beats cavalry by not breaking" has to mean numerically.

⚠️ `infantry→cavalry 15` is the lowest number in either table on purpose:
charging cavalry on foot is the one attack that should almost never be the right
call, and it is cheaper to say so with a number than with a rule forbidding it.

**One of those has no reference behaviour at all** — charge, which facing is now part of rather than a second mechanic beside. ⚠️ That is what binding them bought: there is one thing to tune here, not two that interact. Still **in sequence, never together**: the matchup table against AW's numbers first, then charge head-on, then the directional adjustment. Each stage leaves exactly one unknown to move against an observation.

⚠️ **Plains is not neutral ground.** It carries one defence star, so a table
value only appears raw on road or bridge. Worth knowing before reading a printed
number as a bug.

#### ⚠️ What terrain is actually worth, measured

The doc long carried a worry that `mountain: 4` — a 40% reduction — might make a
unit parked on a peak *unkillable* with eight units and no reinforcements. It
does not. Hits-to-kill, defender on the peak against defender on a road:

| | road | mountain |
|---|---|---|
| infantry → infantry | 4 | 5 |
| cavalry → infantry | 5 | **7** |
| artillery → infantry | 2 | **2** |

**A peak buys one or two blows against small arms, and nothing at all against
guns.** ⚠️ Which is the finding worth keeping: the heaviest attack in the game
ignores the heaviest cover, because 60% of 75 still kills in two. Terrain is a
defence against infantry and cavalry and is simply not a defence against
artillery — so the answer to a unit on a mountain is to shell it, and holding
high ground is a decision about *who* is shooting at you. That reads as correct
rather than as a bug, but it was never chosen, and it is the kind of thing that
should be re-read once charge exists and a peak can be stormed.

**The harnesses exist** — `packages/shared/scripts/matchups.ts` and `charges.ts`, run with `bun`. It prints hits-to-kill across every matchup and terrain, which is the artefact worth tuning against; a raw damage number is not. They have already earned themselves three times: the first killed a table where everything died in two hits and settled the mountain question above, and the second found cavalry-into-artillery saturating at the flank on its opening run. ⚠️ Its details belong to [`architecture.md`](architecture.md) now, not here.

*Sources: [Wars World News — Battle Mechanics](https://www.warsworldnews.com/wp/aw/game-aw/battle-mechanics/) · [AWBW Wiki — Damage Formula](https://awbw.fandom.com/wiki/Damage_Formula) · [Advance Wars Wiki — Luck](https://advancewars.fandom.com/wiki/Luck) · [AWBW Wiki — Terrain](https://awbw.fandom.com/wiki/Terrain) · [Advance Wars Wiki — Indirect Combat](https://advancewars.fandom.com/wiki/Indirect_Combat)*


## Open questions

- ⚠️ **Nothing can ask where a tile is on screen, and a browser is the only check
  the renderer has.** It is WebGL, so it has no unit tests at all; every visual
  verification therefore means screenshotting, measuring by eye, and clicking a
  guessed pixel. A guess that misses is indistinguishable from a bug, which makes
  the workflow trial-and-error by construction — and it is how a real bug
  (`POINTERPICK`) got found by accident rather than by method.

  The fix is small and already half-built: `anchorTo` projects a tile to screen
  pixels every frame. Exposing that in dev — a `tileToScreen` on the renderer, or
  a `window.__vod` handle behind `import.meta.env.DEV` — turns every future check
  from *guess a pixel* into *address a tile*, which 10a and 10b both need and
  which would have made this step's verification a fraction of its cost. ⚠️ It is
  test-only surface on a production object, which is the reason to think before
  building it rather than the reason not to.

- ~~**Counter-attack for `min > 1` units.**~~ ✅ Settled, twice. First from the band alone: a counter fires when the attacker is inside the defender's range, whatever that range is — which let two guns answer each other at reach. Play said no, and `slow` closed it the other way: a gun never answers. ⚠️ Worth keeping from the round trip is that the first answer was *derived* and the second had to be *declared* — "may not move and shoot in one turn" is a fact about a turn, and no arrangement of distances was ever going to produce it.

## Known compromises

Deliberate limits of the current design, and what each would take to lift. Distinct from *Out of scope for v1* below, which is unbuilt features rather than accepted limits.

| | Current state | What it needs eventually |
|---|---|---|
| **Session identity** | Opaque id in an httpOnly cookie; the server trusts it on sight | *Multiplayer and auth* — a real session record behind whatever provides identity. Same cookie, real meaning. No passwords at any point |
| **`actor` under hot-seat** | Server stamps `currentTurn` on its one connection | *Multiplayer and auth* — session→player map established at join |
| **Matches are unowned and unbounded** | Anyone can create any number; no delete, no expiry. `list()` is capped at 50 newest — a bound, not pagination | *Multiplayer and auth* — scope listing to the player, and add deletion. Until identity exists there's nothing to scope by |
| **Async play** | Works already — a returning client fetches current state and resumes. What's missing is knowing a match is waiting on you | *Multiplayer and auth* — match lifecycle and, eventually, notification. Not new mechanics |
| **Ruleset versioning**, and with it **old matches are expendable** | None. ⚠️ `current_state` and `initial_state` are JSON columns with `.$type<GameState>()`, which is a **compile-time cast and no runtime check** — so a match stored before a field existed reads back missing it while the types insist otherwise. A shape change therefore does not migrate rows; it abandons them, and that is **accepted policy until a ruleset id exists** rather than an oversight. The dev database is gitignored scratch: delete it. ⚠️ The failure is silent where it matters — a `Unit` with no `health` is `undefined`, and `undefined` arithmetic is `NaN`, so the first symptom is a damage number rather than an error | Stamp a ruleset id on the match so old logs replay under the rules they were played with. That is also what retires the policy above: a match that knows its ruleset can be refused rather than quietly misread |
| **Maps live in code, not a table** | Modules in `server/maps/`; `map_id` is a plain text column with no foreign key. Picked from at match creation, and browsable at `/maps` | ✅ **Decided** — a `maps` table plus an editor, in *Content*. ⚠️ The other condition — enough maps to choose among — has already been met, so this is due a re-read rather than a wait; see below |
| **Elevation is visual only, and capped at 0.5** | Height is a look, never data. A mesa and a bridge deck raise where a unit *stands*, but `shared/` has no idea: there is no height on a tile, `entryCost` never asks about one, and no rule reads one. ⚠️ Both halves of the old technical objection are now gone — `screenToTile` tries every surface height tallest-first, so a click finds a peak where it is drawn, and `surfaceAt` is a lookup that knows each tile's height. What caps height now is the *camera*: at 38.6° a surface at height `h` draws `1.25h` tiles up-screen, and past about half a tile it occupies its neighbour | ⚠️ **Nothing — this is where it stays.** It was once written here as waiting on machinery, which stopped being true when picking learned about height, and elevation as a *rule* is now declined for v1 rather than queued. Mesas are enough at this board size. The reasons, and the two findings worth keeping if it is ever reopened, are in *Out of scope for v1* |
| **Shared build step** | TS source consumed directly, bun-only | A build if the server ever moves off bun |
| ~~**`shared/`'s test files are not typechecked**~~ ✅ **Fixed.** `tsconfig.dev.json` covers `scripts/` and `src/**/*.test.ts` together — see *Testing* in [`architecture.md`](architecture.md). It cost `@types/bun` as a devDependency of the zero-dependency package, and it surfaced **twenty** errors that had been invisible | — |
| **Migrations run at boot** | `migrate()` on startup, fine for one instance and ~0.4 ms once nothing is pending. Drizzle lists runtime migration as a first-class flow for monoliths, so this is a choice rather than a shortcut | `bun run db:migrate` as a deploy step, once there is more than one instance, a rolling deploy, or a reason to deny the runtime DDL rights |
| **Two reads per command** | `resolveActor` needs state to stamp `actor = currentTurn`, but `submit` owns the read | *Multiplayer and auth* — `resolveActor` becomes a session lookup and the extra read disappears |

### Maps in a table

✅ **Decided: maps become a table.** The trigger condition below was met a
while ago and the decision is now taken rather than pending. ⚠️ It also grows a
second half that was never in the original argument — **a map editor**. Rows in
a table are only better than modules if something other than a text editor
writes them, and an editor is what turns "maps are content" from a claim into a
fact. That is a phase of its own and belongs near *Depth*, not here; what
belongs here is that the storage decision no longer waits on anything.

⚠️ **The original argument, unchanged, and its condition:** It said *revisit when there are enough maps to choose among* —
there are enough to choose among, and **two** screens now pick between them:
`StartScreen` chooses what to play on and `/maps` exists only to look through
them. That is the picker
this section names as what turns maps into a library rather than a constant, and
a library of selectable rows is what a table is for. ⚠️ The viewer arrived after
this was written and makes the case louder rather than differently — a second
reader of the registry is a second thing a `maps` table would serve.

What follows is the argument as it stood at one map. None of it has been
refuted, and the one real risk it names was closed in the meantime by making
map ids immutable. What has *not* happened is the other half — maps that stop
being written by developers, which is what user-authored maps, random selection
or filtering would bring.

The tempting argument against — *content lives in code, like `terrain.ts` and
`unitTypes.ts`* — does not actually hold. Those are **fixed global lookups**:
one table each, always loaded, never chosen between. Maps are a **collection
you select from**, which is a different shape and a more database-shaped one.
What holds instead is narrower:

- The character-grid format exists to be read in a diff. A `TEXT` column keeps
  the format and throws away the reason for it.
- There is no seeding machinery. Migrations are schema-only and nothing inserts
  data at boot, so a table means inventing an idempotent seed step.
- The foreign key would protect metadata that cannot corrupt anything —
  `initial_state` holds the instantiated grid, so a match replays correctly
  whatever `map_id` points at. A dangling id is a wrong label, not a broken
  match.

⚠️ **One real risk while maps stay in code:** editing `classic.ts` retroactively
changes what every existing match's `map_id: 'classic'` refers to. This is
ruleset versioning in miniature. The cheap mitigation is not a table — it is to
treat **map ids as immutable**: a changed map gets a new id, and the old one
stays as it was played. Stamping the map rows onto the match row is the other
option, and both cost a few lines against a table's seeding machinery.

## Out of scope for v1

- **Transports.** `Unit.position` becomes `{ kind: 'onBoard'; coordinate } | { kind: 'carried'; by: string }` so the invalid state is unrepresentable, with cargo derived by query rather than stored on the transport.
- **Buildings / capture points.** A terrain type with attached `{ owner, captureProgress }`, not a separate object layered on a tile.
- **Graying out acted units.** The mechanical restriction is in scope; the visual is a later UI pass — but note phase 9 asks for a "units that can still act" indicator, which is the same thing under another name. Whichever phase draws it, it should be one treatment, not two.
- **Elevation as a rule.** Height stays presentation only: `surfaceAt` lifts a unit onto a mesa and picking finds it there, but no rule reads a height and no tile carries one. Declined for four reasons, in the order they bite. **Terrain already says it** — `mountain` is `defense: 4` and costs a horse 4, which is "high ground is worth holding and dear to reach" under another name, so a height *defence* bonus would tune one dial twice. **Two original mechanics are still settling** — charge and facing both shipped, and play has since moved three things to get them sitting right; a third interacting axis is the trap this document warns about elsewhere, and it is a worse bet now there is evidence the first two needed the tuning. **The camera caps it** — at 38.6° a surface at height `h` draws `1.25h` tiles up-screen, and a spike showed tile identity collapsing by a full tile, so real relief needs a lower, rotating camera. And **it changes the pace**: "can I get up there" becomes a question on every move, which is Final Fantasy Tactics' game rather than Advance Wars'.

  ⚠️ Two findings worth keeping if it is ever reopened. `entryCost` takes a *destination*; height would make it take a **step**, which is a real signature change but a contained one — `exploreMovement` and `validatePath` are its only callers, and invariant 10 is what guarantees that. And if height ever did enter combat, the door is an **attack** bonus for striking downhill rather than a defence bonus for standing high, because terrain does not express the former and already expresses the latter.
- **Manual routing.** Dragging out a deliberately non-optimal path. Unblocked by the protocol carrying a path and the server validating it — purely a matter of building the UI for it. ⚠️ The substrate now exists and did not before: a route is **pinned, re-pinnable, and drawn as an arrow**, so waypoints have something to hang off rather than needing the whole idea built at once.
- **A blocky / voxel art style.** Tried on a branch with [KayKit's Block Bits](https://kaylousberg.itch.io/block-bits) and rejected — recorded so it is not re-litigated from the screenshots alone. It works: every terrain maps onto a block, and **the autotiler turns out not to be load-bearing** — a cube has no shoreline, so a one-tile river bends through a right angle with no mask arithmetic at all, and `composeTerrain` drops from ~250 lines to ~60. What killed it is the camera. The style lives on block *sides*, a near-top-down board shows only tops, and stepping by whole blocks to expose the sides is the elevation problem above. So it is a real option, but only alongside a different camera — not a swap.


## Remaining phases

⚠️ **Three of these are a queue and two are tracks.** 11, 12 and 15 run in that
order. 13 and 14 depend on none of it and are what actually move the numbers a
portal gates on, so they run alongside rather than waiting their turn, in
whatever order is most interesting that week. ⚠️ One exception to that
independence: 11 decides matches are meant to be **short**, and how long a match
runs is content, which is 13. Co-presence puts two people at the board at the
same time; only the content makes that a single sitting.

⚠️ **Multiplayer comes before deploying, and that is a product decision rather
than a technical one.** A hosted build could ship the day the asset paths are
fixed, and for a while this file said it should. It should not: hot-seat was
scaffolding for building the game, not a way to play it, and putting a
two-people-one-keyboard turn-based strategy game in front of a portal audience
is shipping the wrong product and learning nothing true from what it does.
⚠️ The cost of the order is that **phase 11 has to take phase 12's constraint as
an input** — identity gets designed knowing the client will later be served from
another origin, rather than having that discovered afterwards. That constraint
is written into 11 below, where the decision is actually made.

⚠️ **Cross-references name a phase rather than number it.** Inserting phase 11
renumbered the one after it and turned every "Phase 11 —" in *Known
compromises* into a pointer at the wrong thing. A name survives an insert; a
number is a thing somebody has to remember to recount.

⚠️ **Platform mechanics are not written down here.** They are per-platform,
dated, and change — see *Victory or Death — Publishing Pipeline* in Drive, which
carries the gate, exclusivity, identity and size rules for each portal with the
date each was verified. Anything copied into this file is a second copy to keep
in step, and the last audit of this document was mostly about exactly that.

### 9 — Combat: the smallest thing you can win ✅

Terrain and pathing already exist, so the numbers mean something. The integration risk here is the chain — command → resolve → events → animate → death → mesh removal → victory — not the damage formula.

⚠️ **Almost nothing original was in this phase, and that was the point** — a phase that can be wrong in a way a reference will tell you about, before one that cannot. ⚠️ **9k is the exception, added late**: a shot from directly behind goes unanswered, which is the first rule in the game to read facing. It was allowed in because it costs no new constants and reuses the counter predicate that was already there; charge, the other original mechanic, still waits for phase 10 in full.

- **9a** — *moved to 6a.* The `UnitType` catalog wiring is a prerequisite of the terrain cost table, not a consequence of combat; see phase 6's hard dependencies.
- **9b–9e** ✅ **Shipped**, and gone from here rather than ticked: `health` on
  `Unit` with `MAX_HEALTH` on the catalog side, `BASE_DAMAGE` and
  `computeDamage`, the tuning harness, `range: { min, max }`, and `syncUnits`
  removing the meshes of the dead. What each does now lives in
  [`architecture.md`](architecture.md) — the formula and its banding under
  *Combat*, the tables under *Content*, mesh removal under *Rendering*.
  ⚠️ Two decisions they forced are **not** there, because they are still
  forward-looking and stayed in this file: old matches are expendable until
  a ruleset id exists (*Known compromises*), and luck's flat ordering with the
  measurements behind it, which now live in *Combat* in
  [`architecture.md`](architecture.md) and in `git log`.

- **9f** ✅ **Shipped**, and gone from here: `MoveCommand` gains an optional
  `targetUnitId`, `battleResolved` joins the event union, `resolveAction` takes a
  roll, and `rollLuck` in `match.ts` is the only randomness in the codebase. What
  it all does now lives in [`architecture.md`](architecture.md) under *Combat*
  and *The pipeline*.

  ⚠️ **It also settled two things this doc had wrong.** The snap budget needs no
  combat term — `animatedTiles` scoring a battle zero was correct while nothing
  animated one, and it was to become the cutaway's problem. ⚠️ It did not: the
  tile model was replaced by an event count before the cutaway arrived, and a
  battle is an event. And the
  client needed **no change at all**: both places that switch on an event type
  already handle a new member, and `syncUnits` moves the ring and removes the
  dead from state it reads anyway.

- **9g** ✅ **Shipped**, and gone from here: `wouldCounter` in `combat.ts`, the
  counter inside `resolveBattle`, and `Rolls` as `{ attack, counter }`. See
  *Combat* in [`architecture.md`](architecture.md).

  ⚠️ **The turn-budget hazard this step was warned about does not exist**, and
  the proof is now a test rather than a paragraph: a counter killing the
  attacker takes one from each side of `actionsTaken + 1 >= actionsAllowed`, so
  the inequality is invariant under it. Pinned in `turns.test.ts` precisely
  because it holds by arithmetic rather than by design.

- **9h** ✅ **Shipped**, and gone from here: `readActionClick`, the `targetChosen`
  phase, the attack overlay, and the panel. See *Client* and *Combat* in
  [`architecture.md`](architecture.md).

  ⚠️ **The overlay's colour cost three attempts, and the reason is the board.**
  Red and the teal ground are near-complementary, so blending them gives *grey*:
  a desaturated red at 0.34 alpha was invisible and a strong red at 0.4 read as a
  dirty tile. It sits at 0.8 where every other overlay is a wash, which is
  recorded in the code beside the constant.

- **9i** ✅ **Shipped.** The ten-segment ring, in `healthRing.ts` — see *Rendering* in [`architecture.md`](architecture.md). ⚠️ **Its animation is not built and will not be** — the *cutaway* is the damage animation and the ring is the persistent state beside it, for the reasons below. This once said the animation "cannot be" built because nothing changed a unit's health yet; 9f made health change, so the reason expired while the conclusion held. Verified by temporarily deploying wounded units, screenshotting, and reverting. What follows is the original note, which still describes why it matters.

  **Health has to be visible**, and was missing from this phase entirely. 9b put `health` in the model and 9f makes it change, but nothing draws it — a unit at 40 reads identically to one at 100, which makes combat unplayable by eye and unverifiable in the browser, the only check the renderer has. Smallest thing that works: a billboarded bar or a scaled emissive band on the unit mesh, driven from `syncUnits` since that already runs per commit with the state in hand. It belongs before any tuning at all, because a matchup table whose results you cannot see is tuned by guesswork.

  ⚠️ **The facing marker moved to phase 10** — nothing reads facing until charge does, so a ground chevron here would be drawing a fact that changes nothing. 9i is the health bar and only that.

  ✅ **Settled: a ten-segment ring at the unit's base** — see *Rendering* in [`architecture.md`](architecture.md) for the shape, and *The combat cutaway* for why the focused view is unbanded where this one is not. Ten segments for ten bands is what stops the display over-promising precision the formula does not have.

  ⚠️ **The ring inherits `PIECE_SCALE`, and that is probably right.** A ring parented to the unit node is scaled with it — infantry 1.5, artillery 1.2 — so the rings come out different sizes. But `PIECE_SCALE` exists to make each piece fill its tile for readability, so a ring scaling with it stays *proportionate to its piece* and still fits. Leave it inheriting and judge it in a browser; `1 / PIECE_SCALE[type]` on the child is the one-line fix if artillery's reads too small. ⚠️ The structurally tidier answer — scale and rotation on separate nodes — is **not** two nodes: the model child is the loader's `__root__`, which carries the handedness flip as a negative-z scale, which is exactly why scaling sits on our node today. It would take three levels.

  ⚠️ **One writer: `syncUnits` snaps it, and the ring never tweens.** An earlier draft had `playEvents` animating segments out as damage landed, which would have made the ring the damage animation. It is not — **the cutaway is**, and the ring is the persistent state beside it. That removes a hazard as well as work: a tween on the ring is a different animation target from the unit node, so `scene.stopAnimation(mesh)` would not have reached it and a snap could have landed on a value still in motion. No tween, no orphan.

  ⚠️ **And this step moves ahead of the combat command.** It is scheduled after 9f here for historical reasons and that ordering is wrong: the ring *is* the damage animation, so shipping combat first means shipping it with no feedback at all — health changing invisibly, units vanishing mid-frame, and the database as the only way to tell an attack happened. It is also what makes 9f checkable in a browser, which is the renderer's only check.
- **9j** ✅ **Shipped**, and gone from here: `soleSurvivor` and `isOver` in
  `victory.ts`, the `gameEnded` event, `winner` on `GameState` and on the
  `matches` row — see *Victory* in [`architecture.md`](architecture.md).
  ⚠️ **`playerEliminated` is deliberately unbuilt**: with two players it would
  state the same fact as `gameEnded` twice. It becomes the right shape with
  three, and is purely additive when it comes, because nothing in `GameState`
  marks elimination for an absent event to desync.

**Does 9f roll?** Yes. The step reads "damage from a table" and also "plus rolls", which is a contradiction worth settling in favour of rolling: the rolls plumbing — the server generating them, `Action` carrying them, resolution taking them as an argument so `shared/` stays pure — is the only *structurally* new thing in 9f, and it is what makes 9j's preview mean anything. A deterministic first cut would defer exactly the part worth proving.

**Keep game outcome separate from lobby status.** An outcome is a fact about the board — produced by a reducer, replayable from the log — so it belongs in `GameState`. "Waiting for an opponent to join" is about *users*, belongs on the `matches` row, and no reducer should know about it. A single `status` field spanning both is the muddle to avoid.

⚠️ **The board's vocabulary gets judged here, and nowhere earlier.** Terrain has exactly two mechanical dimensions — `cost`, which movement reads, and `defense`, which `computeDamage` now reads. So a terrain differing only in `defense` was *indistinguishable in play* until 9c, and one differing only in `cost` mostly duplicates what `river` already is: passable on foot, shut to horse and wheels. That is why renaming `mountain` to something the period would recognise buys accuracy and nothing else, and why new types are worse than nothing until the numbers they differ by are read by something. ⚠️ **And the count is five, not six.** `road` and `bridge` are mechanically the same terrain — `defense: 0` both, `cost: { foot: 1, horse: 1, wheels: 1 }` both — differing only in the character that draws them and the model that renders them. So the question this phase answers is whether *five* distinct terrains give enough tactical variety, which is a different question. Revolutionary-war terrain is a real want — fields, woodlots, orchards, marsh, and stone walls above all — but the first three are a **palette** job that touches no rule (`terrainModels.ts` material overrides), and the last is not a tile at all: a wall gives cover *from one direction*, which makes it an **edge** feature against a grid that only has cells, and it multiplies with facing. Both halves of that belong after this phase can say whether the distinct ones give enough tactical variety.

**Where identity shows up.** Two bits of UI here need to know who the user is — a "your units that can still act" indicator, and a victory screen saying *You won* rather than *Blue won*. Get it from one function rather than inlining `state.currentTurn` at each call site. Hot-seat: whoever's turn it is, because two people share one client. With auth: the session. Same concept, different source — nothing to build in advance.

Selection doesn't need it: `canSelectUnit` is a game fact ("may this unit act"), and the server already rejects a command for a unit the actor doesn't own, because `actor === currentTurn` and `unit.owner === currentTurn` compose.

### 9.9 ✅ **Shipped**, and gone from here

The action panel, `MenuStep`, the two back-out rules and `canFire` — see
*Client* in [`architecture.md`](architecture.md).

⚠️ **It also uncovered a bug that had shipped long before it.** The pointer
handler listened for `POINTERPICK`, which Babylon emits only when its ray hits a
*pickable mesh*, while the terrain sets `isPickable = false` because lookup here
is plane arithmetic. So clicks only arrived where some other pickable mesh
happened to be — a unit, a tree, a lit overlay quad — and a sweep of sixteen
points across the board registered **one**. It survived because almost every
meaningful click lands on a unit or a lit tile, and *click elsewhere to cancel*
was quietly dead the whole time. `POINTERTAP` fixed it; the same sweep now
registers sixteen.

⚠️ **And it exposed a gap in how visual work gets verified.** The renderer has no
unit tests, so a browser is its only check — but nothing can be *asked* where a
tile is on screen, so every check means reading a screenshot and guessing pixels.
A miss then looks exactly like a bug. That is how the `POINTERPICK` bug was
found, which is luck rather than method: the first miss should have been
instrumented, not retried with new coordinates. See the open question below.

### 10 — Combat depth

⚠️ **Charge is what is left of "everything original", and facing is no longer
waiting here.** This said facing and charge land together *because facing is read
by charge and by nothing else* — which stopped being true when 9k shipped: a shot
from directly behind goes unanswered, `attackSide` is built and tested, and
`flank` is already classified and waiting for a reader. So phase 10 is charge,
plus the view charge needs to exist before it can be designed.

⚠️ **That weakens the "one unknown at a time" argument without retiring it.** The
worry was that a rear charge puts two untested mechanics inside one expression.
The *classifier* is now proven, so what is unknown is only the multipliers —
still worth tuning head-on first, but for the smaller reason that two dials in
one formula cannot be read apart, not because the geometry might be wrong.

- **10a** ✅ **Shipped**, and gone from here: the charge tables, both formulas,
  `resolveCharge`, the dispatch on `attackKind`, the `Rolls` union, `terrainAdmits`,
  the Charge row and its overlay — see *Charge* under *Combat*, and the client
  half under *Client*, in [`architecture.md`](architecture.md).
  `scripts/charges.ts` prints the odds against the repel band, head-on and on
  road, which is the artefact its tuning pass reads.

  ⚠️ **`directionalMultiplier` is still absent from the formula**, not pinned in
  it — 10b adds the term rather than changing a 1 to a variable.

  ⚠️ **A browser found what the tests did not**: aiming a *charge* showed the
  *fire* forecast, because `attackForecast` computed damage without asking which
  mode it was in. The panel had been specified to show exact odds and was not
  built that way. Pinned by a test now, but the renderer has no unit coverage and
  this was one layer above it — the lesson is that a specified-but-unbuilt
  surface reads as done until something looks at it.

- **10b** ✅ **Shipped**, and gone from here: `FLANK_MULTIPLIER` and
  `REAR_MULTIPLIER` multiplying the threshold inside `chargeChance`, and
  `scripts/charges.ts` printing all three approaches — see *Charge* under
  *Combat* in [`architecture.md`](architecture.md). No client change was needed:
  the panel calls `chargeChance`, so its odds picked facing up for free.

  ⚠️ **The harness earned itself on the first run.** `cavalry → artillery` at a
  base of 60 saturates: the flank is 100% from 85 health down and the rear is
  100% everywhere, so the two are distinguishable only against a full-health
  battery. The rear multiplier is doing nothing in that row. That is precisely
  the dead dial this step was told to watch for, it is invisible in a head-on
  column, and it is a **tuning** finding rather than a bug — the numbers were
  written down to be argued with. See *Tuning* for where it stands.

- **10c** ✅ **Shipped**, and gone from here: `render/cutaway.ts`, the
  `battleResolved` branch in `playEvents`, and the DOM readout — see *The combat
  cutaway* under *Combat* in [`architecture.md`](architecture.md).

  ⚠️ **Three composition defects only a browser could find**, each fixed by
  measuring rather than guessing again: the figures were thumbnails adrift in
  their half of the band, then sunk to the floor with dead air above them, and
  the readout crossed their feet. The framing is taken from the built meshes'
  bounding box now, and the readout's strip is reserved in the camera.

  ⚠️ **Model animation is still absent**, which was always this version's scope:
  the figures stand. `battleResolved.kind` is what will pick between a volley
  animation and a charge one, and it is carried for that.


### 11 — Multiplayer: identity, and two clients in one match

**Two people, in the same match, at the same time.** The shape is a game of
chess: sit down, play it now, finish it now. That is the sentence the rest of
this phase is derived from, and everything below follows from it.

⚠️ **Played in one sitting.** Both players at their clients, the match started
and finished now. ⚠️ **"Live" here is a *session shape*, not a transport** —
it says when the two people are present, not how bytes reach them, and the two
are independent. **No push and no WebSockets still stands**, in `CLAUDE.md` and
in the architecture doc, and this phase does not re-open it. A turn lands within
one poll; a poll is 2 seconds; a game of chess is unbothered by 2 seconds.

⚠️ **Long-form async is a later iteration, not the rejected alternative.** A
returning client already fetches state and resumes, so the substrate is there —
what it would need is a reason to come back, which is notification, which is its
own thing. Nothing in this phase forecloses it.

⚠️ **Identity is a guest by default and an account by choice.** Nobody signs in
to start playing: a guest id is enough to own a match and be *you* across turns,
which satisfies "no passwords, ever" trivially and costs a fraction of OAuth.
Signing in is the upgrade for people who want an identity that persists, and
Better Auth supports exactly that split as a first-class path — see the spike
result below, which came back green. ⚠️ Frictionless to first move is the requirement, and it is
worth stating as one: on a portal, a sign-in wall in front of a free game is
the funnel.

⚠️ **Hot-seat is removed, not kept.** It was scaffolding, and two browser tabs
are two players — which is cheaper than the per-match mode on `resolveActor`
that keeping it would cost, and that function is the most security-sensitive one
here. ⚠️ Every test and manual check in the repo is written in hot-seat, so
this is a real edit to the suites rather than a deletion.

⚠️ **This section was written assuming we own identity, and two target
platforms forbid that.** CrazyGames requires progress tied to a CrazyGames
account with automatic login and permits **no external login options**;
Kongregate permits **no account system in a new game** and requires
authentication through its API. So "OAuth sign-in with sessions in our own
database" is one provider, not the design.

⚠️ **What survives is the seam, and it already exists.** `resolveActor` is the
single place a request becomes a `PlayerId`, and the work is to make it
pluggable rather than to pick a winner: hot-seat is a provider, our own OAuth is
a provider, a portal SDK is a provider. Everything below about sessions, cookie
rotation and ownership is right for the provider we host, and simply does not
apply to the ones we do not.

⚠️ **The first provider is ours**, because the first platform is itch and itch
has no accounts to borrow. The seam still earns its place, for the opposite
reason to the one first written here: ours will have to sit *beside* a portal's
rather than instead of it.

#### How identity travels — ⬜ **open, and both options are compromised**

⚠️ **Decided here rather than in 12**, because by then the sessions are built.
The client will be served from another origin — itch hosts the files, the server
stays ours — and that breaks the cookie in a way `SameSite` alone does not fix.

⚠️ **This said "settled" and it is not.** Every option has a real hole, the
holes are different shapes, and picking between them is a judgement about this
game's threat model rather than a lookup. Four findings, in the order they
overturn each other:

1. **`SameSite=Lax` is dead cross-site.** Lax means the browser does not send
   the cookie on a cross-site request at all, so a client on itch gets no
   session. That much was already written down.
2. **`SameSite=None` alone is not enough either.** Safari has blocked *all*
   third-party cookies since 13.1 regardless of `SameSite`, so the obvious fix
   fails on Safari outright. ⚠️ This is what briefly made a bearer token in
   `localStorage` look like the answer.
3. **But `localStorage` is the wrong place on itch specifically, and that is a
   fact about itch rather than a judgement.** Every itch HTML5 game is served
   from one shared origin — `html-classic.itch.zone`, with no per-game
   isolation and [itch saying they will not add
   it](https://itch.io/t/3099694/notice-for-html-game-devs-upcoming-change-to-cdn-domain).
   So a token in `localStorage` is readable by **any other game on itch**. That
   is the configuration OWASP names explicitly, and it is disqualifying.
4. **`Partitioned` (CHIPS) would close the loop, except on Safari's timeline.**
   An httpOnly partitioned cookie is sent cross-site and unreadable by another
   game's script, which is exactly what the shared origin demands. ⚠️ **But the
   support floor is far newer than it first looked**, and the first reading of
   this got it wrong. From MDN's compat data: **Chrome 114** (2023), **Firefox
   141** (2025), and Safari — **added in 18.4, removed again in 18.5**
   ([WebKit 292975](https://bugs.webkit.org/show_bug.cgi?id=292975)), then
   restored in **26.2, released 12 December 2025**. On iOS every browser is
   WebKit, so *every* iOS device below 26.2 gets no session at all.

⚠️ **So the trade is a functional gap against a theft vector**, and they are not
comparable quantities:

- **Partitioned cookie** — httpOnly, unreadable, and simply *does not work* for
  a real share of iOS users. They cannot play. That is a visible, total failure
  for those people.
- **Bearer token in `localStorage`** — works in every browser, and is readable
  by any other game sharing itch's origin. That is an invisible, partial risk
  for everyone.

⚠️ **Weigh it against what a token is worth here**, which is the part a
textbook cannot do: this is a free turn-based game with no money, no PII beyond
a display name, and guest sessions carrying almost nothing. A stolen session
lets someone move pieces in a wargame. Even signed-in, the token is *our*
session, never a Google one. The attack also needs a malicious game published on
itch and the victim playing it in the same browser.

⬜ **Recommendation, not a decision: do both, and detect.** Better Auth sets the
cookie either way and its bearer plugin reads `Authorization` when present, so a
client can prefer the cookie and fall back to the token when a probe shows the
cookie did not survive. That costs a startup round trip and one branch, and it
is the only option with no group of players locked out. ⚠️ The reason it is not
simply decided here is that a fallback is a *second* auth path through the most
security-sensitive function in the phase, which is the thing this section
otherwise argues against.

⚠️ **CORS is load-bearing, not boilerplate.** A partitioned cookie is still sent
automatically, and the neighbours in that partition are other itch games. What
stops one using it is a **strict origin allowlist**: a JSON `POST` is not a
simple request, so it is preflighted, and a preflight we refuse never becomes a
request. That is the CSRF defence, and it wants stating as one.

⚠️ **Three things the cookie route costs, whichever way this lands:**

- **Safari 26.2+, which is December 2025.** Detecting the failure is the
  requirement, not hoping about it — a player who cannot hold a session should
  be told, not left clicking.
- **ITP can still flag the API domain**, and a flagged domain cannot use
  partitioned cookies either. Unlikely for a game API that appears on a handful
  of sites; not impossible.
- ⚠️ **Partitioned means partitioned.** The session is keyed to the *top-level
  site*, so signing in on itch does **not** carry to CrazyGames — same account,
  different partition, a fresh sign-in. That is a product fact rather than a bug,
  and it is the strongest argument for identity that a player can deliberately
  re-establish (sign in) rather than one they are assumed to keep.

- **Match lifecycle** — a way for a second person to join, and matches bound to users rather than open to anyone. The largest of the three and still a single bullet: it wants a lobby state, a join mechanism, and the `status` column this section is careful to keep apart from game outcome. Phase 4 was split in two for less; this should be split before it starts.
- **Guest identity first**, with sessions in our own database; sign-in is the later upgrade and OAuth is its candidate rather than its conclusion — see *Identity* below, and the seam above.
- **Session→player map** at join, so `actor` comes from *who you are* rather than *whose turn it is*.

#### Seeing the other player move — nothing changes

⚠️ **Not to be confused with *How identity travels* above.** That one is how a
credential reaches the server; this one is how a move reaches the other player,
and only the first of the two is changing.

⚠️ **This was written as an open fork and it is not one.** Co-presence needs no
push: two clients polling a `seq` cursor is already two people watching the same
match, and the only dial is the interval. `POLL_INTERVAL_MS` is 2000, and if a
turn taking up to two seconds to appear reads as sluggish, **the fix is the
number** — at 750 the average wait is under 400 ms, on a board where a move
takes a person several seconds to decide.

⚠️ **Measure before changing even that.** A poll costs a request per client per
interval, and dropping to 750 nearly triples it for a benefit nobody has
complained about yet. The interval is a one-line change whenever it is wanted,
which is the argument for leaving it alone until play says otherwise.

⚠️ **The queue is the one place worth watching.** A player waiting for an
opponent is staring at a spinner, and that is a different tolerance from waiting
on a turn — it is the one interaction where polling could read as lag. Still
almost certainly fine at 2 seconds; noted as the first place to look if
something feels slow, rather than as a reason to build anything.

#### How two people meet

⬜ **Both, with automatic first.** A queue is the default — press play, get an
opponent — and an invite link is the other route, for playing someone chosen.

⚠️ **No portal supplies this.** Every platform checked offers accounts or
nothing; not one has a matchmaking queue. So the queue is ours to build
wherever the game runs, and it is the one piece of "multiplayer" that no SDK
will ever hand over. An **invite link**, by contrast, is what the portals *are*
shaped around — it appears by name in CrazyGames' multiplayer requirements
alongside room state and a rejoin flow — so building it also buys the shape a
later portal will ask for.

⚠️ **A queue is a lobby with the choosing removed**, which is the argument for
doing it first rather than second: a public list of joinable matches is the
same `status` column and the same join path, with a human picking instead of
the server. The reverse — building a list and later inferring a queue from it —
is the one that rewrites.

⚠️ **Open: what the queue matches *on*.** With one army and one ruleset it is a
FIFO pair-off and nothing more. Map choice, and eventually anything like a
rating, are what turn it into a real matchmaker — and neither exists yet, so the
honest first version is the pair-off.

✅ **The Better Auth spike is answered, from its own docs.** It asked three
things and all three come back usable:

- **No framework adapter needed.** `auth.handler(request)` takes a standard
  fetch `Request` and returns a `Response`, which is exactly what a `Bun.serve`
  route hands it. The framework adapters are convenience wrappers around that
  same call — the question that gated this phase turns out to have been the
  easy one.
- **Drizzle with `provider: 'sqlite'`** is first-class, which is the client
  already in use.
- **The cookie question changed shape** rather than being answered: it is not
  "does its cookie replace `vod_session`" but "can its cookie carry the
  attributes *How identity travels* needs", and `defaultCookieAttributes` is
  exactly that hook. ⚠️ **Its bearer plugin is the other half of that still-open
  question.** Its own docs caution that the plugin is for APIs which cannot use
  cookies — which, on every browser where a partitioned cookie does not survive,
  is arguably what we are.

⚠️ **And it already implements the decision at the top of this phase.** The
[anonymous plugin](https://better-auth.com/docs/plugins/anonymous) is
guest-by-default and account-by-choice as a supported path, not a pattern to
assemble: `/sign-in/anonymous`, `/anonymous/link`, and an `onLinkAccount`
callback for carrying a guest's matches onto the real account when they sign in.
Google is then a config block and a redirect route.

⚠️ **The cost is that it owns the schema**, and that is the decision rather than
the difficulty. Adopting it means its `user`/`session`/`account` tables instead
of ours, and `withSession` disappears entirely. ⚠️ **Which argues for adopting it
first rather than second** — hand-rolling two tables and migrating onto them
later is building the session system twice, and the guest path is the half that
would be thrown away.

⬜ **What is left to verify, and it is narrow**: that `defaultCookieAttributes`
reaches `Partitioned` (a newer attribute than the option), and that the
anonymous plugin's session survives the same attributes. Both are an afternoon
against a real browser, and neither gates the design.

**The shape, either way.** If Better Auth is adopted its schema stands in for
the first two of these; if it is not, they are what gets built:

```
players        a person, guest or signed-in; a guest is a row with no credentials
sessions       token → player, so sign-in can rotate the token onto the same person
match_players  match, player, seat — who is blue and who is red
```

⚠️ **A join table rather than `blue_player_id` / `red_player_id` columns.**
`soleSurvivor` already generalises victory to any number of players and
`GameState.players` is already an array, so two columns would be the one place
that re-hardcodes two — for no less work.

⚠️ **`owner_id` lands on a table full of unowned rows**, exactly as `'land'` tiles meet phase 6. Nullable column, backfill to a sentinel, or wipe — dev-only data, so wiping is almost certainly right, but it is a step to write down rather than hit.

⚠️ **Hot-seat stops working by construction** the moment `actor` comes from the session — every match ever played here has been two players sharing one browser. It was scaffolding, so it is not a *shipped* mode (see the top of this phase), but that leaves the narrower question of whether it survives as a **dev affordance**, and the cost is the same either way: a per-match mode on `resolveActor` is a second path through the most security-sensitive function here. ⚠️ The thing not to do is discover the answer while writing the auth code.

Schema work: `owner_id` on `matches`, a lobby `status` column, and a `sessions` table — three migrations, generated from `schema.ts`. Also **removes a read**: `http.ts` currently loads the match twice per command because `resolveActor` needs state to stamp `actor = currentTurn` while `submit` owns the read. A session lookup needs no state, so the extra read goes with it.

`resolveActor` is the only server change: it stops returning `state.currentTurn` and looks up the session. Client-side, the one function that answers "who is the user" reads it from the session instead of deriving it, and gains an ownership check so a browser doesn't offer units it can't command.

#### Identity

**OAuth only, sessions in our own database. No passwords, ever.**

Sign in with a provider (Discord is the natural fit for a game; GitHub or Google work the same way). Store `(provider, external_id) → player_id`, issue our own session token into a `sessions` table, and resolve it to a `PlayerId` per request.

Never accepting a password deletes the parts of auth that are both hardest and most dangerous — hashing, reset flows, verification email, breach response. We never hold a credential worth stealing. A **magic link** is the natural later addition for people who do not want a third-party account; it keeps the same property.

A small OAuth library plus a sessions table, not an auth platform. Hosted providers (Clerk, WorkOS, Auth0) stay a contained swap if auth ever becomes a distraction.

**Better Auth is the candidate and the spike came back green** (above), because it *is* that description rather than an alternative to it: sessions in our own database, a first-class Drizzle adapter, SQLite supported, httpOnly cookies, OAuth providers, no password path required, and guest-to-account as a supported plugin. It would replace `resolveActor`, supply the `sessions` table, and subsume `withSession` entirely — session creation becomes an insert, which retires the concurrent-mint race rather than working around it.

**It is still a cookie**, which is the same mechanism the server already uses — what changes is its *attributes* (see *How identity travels*) and what it *means*: a row tied to a real player record, rather than an opaque id the server trusts on sight.

Whatever provides identity, **it resolves to a `PlayerId` in one place on the server**, before `actor` is stamped. Auth is a lookup in front of the authority, never something the reducers know about — and game rules never move into the database layer, whatever the store turns out to be.

Until all three land, two tabs share control of both players rather than being two players.

#### Security work that only becomes possible here

**Today there is no authorization, not weak authorization.** `resolveActor` ignores the session and returns `state.currentTurn`, so the cookie gates nothing: any client, with or without one, can submit as whichever player's turn it is, to any match id — and `GET /api/matches` hands out the ids. That's the deliberate hot-seat concession, but it's worth stating in those terms, because several defences are pointless until it changes:

- **CSRF hardening is premature *today*, and stops being so in this phase.** `SameSite=Lax` currently blocks a cross-site POST from carrying the cookie, and an attacker doesn't need the cookie anyway — there is no authority to forge. ⚠️ **Both halves of that expire together here**, if the cookie route wins: `resolveActor` starts trusting the session, and `SameSite` goes to `None`, so the cookie *is* sent cross-site. The defence is then a **strict CORS origin allowlist** — a JSON `POST` is preflighted, and a refused preflight never becomes a request — which makes the allowlist a security control rather than configuration, and it should be reviewed like one. ⚠️ **A bearer token needs none of this**: a header attached deliberately is never sent automatically, so CSRF is not a category for it at all. That is the point in the token's favour that *How identity travels* weighs against the shared-origin problem.
- **`GET /api/matches` becomes an information leak.** It currently lists every match from every visitor. Harmless while matches are unowned; the moment they're owned, listing must be scoped to the player — which is the same change already recorded under Known compromises, arriving for a second reason.
- **`404` on a missing match stops being neutral.** Once matches are owned, "no such match" and "not yours" should be the same response, or the endpoint becomes an existence oracle.

⚠️ The race below is survivable today partly by accident: in dev, Vite serves `index.html`, so the browser's first contact with *our* server is already an API call, and in production the HTML response sets the cookie before any API call can race. If dev ever collapses to one process serving both, that accidental ordering becomes the only thing between us and concurrent cookie-less requests on a cold load — the constraints below would stop being a production-only concern.

**Two constraints on the sessions table, from how the cookie behaves today.** `withSession` mints an id for any request arriving without one, so concurrent requests from a browser with no cookie yet each mint a *different* id and each set it — last write wins. That is not a defect: nothing reads the id (`resolveActor` ignores it) and nothing persists it, so there is no state to corrupt. It becomes one the moment a session store assumes otherwise, which is why the requirements are recorded here rather than worked around in the wrapper:

- **Create session rows at sign-in, not on arrival.** The orphan problem is a *rows* problem. If a row only exists once someone authenticates, the ids a browser mints and discards never become rows, and the race stops mattering without needing to be prevented — which is the only approach that works, since two cookie-less requests are indistinguishable and cannot be serialised.
- **Rotate the id on sign-in.** An id minted for an anonymous visitor must not survive into an authenticated one, or an attacker who plants a known cookie inherits the session after the victim logs in. Standard session-fixation defence, and it makes every pre-auth id irrelevant by construction.

Both are defaults in Better Auth, which is a further point in its favour above.

**Where the check goes.** Whatever provides identity resolves to a `PlayerId` in one place, before `actor` is stamped — see *Identity* above. Ownership is then a lookup in front of the authority, never a rule the reducers know about. Note that `canSelectUnit` deliberately stays a game fact and needs no identity: the server already rejects a command for a unit the actor doesn't own, because `actor === currentTurn` and `unit.owner === currentTurn` compose.

### 12 — A hosted build on itch.io

**itch.io.** Open, no gate, no review, no exclusivity, and no accounts to
integrate — so it is the one portal where "does this deploy at all" can be
answered without also answering anything else. Everything below is what itch
specifically requires; the other portals want a superset.

The smallest remaining phase, and no new mechanics: it is the deploy story.
⚠️ **It could have gone first and deliberately does not** — see the top of
*Remaining phases* for why, and note that the one decision it would otherwise
own, whether identity rides a cookie across origins, is taken in 11 instead
because 11 is where the sessions get built.

- ⚠️ **Asset paths are absolute and itch serves from a subdirectory.** Verified,
  not anticipated: the build emits `src="/assets/…"` and `href="/favicon.svg"`,
  which resolve to the CDN root and 404 under a game's own subdirectory. Vite's
  `base` fixes the bundled ones. It does **not** fix the four URLs built at
  runtime — `MODEL_URLS` in `unitModels.ts` and `MODEL_DIR` in
  `terrainModels.ts` are plain strings the bundler never sees, so they need the
  base threading through them. ⚠️ Both failures are a blank canvas rather than
  an error, which is the argument for fixing them before the first upload
  instead of debugging them through itch.

- **Same-origin stops being true.** Today the client calls `/api/*` relative and
  that works in dev (Vite proxies) and in production (the server serves the
  bundle). itch hosts the zip on its HTML5 CDN and says the backend must live
  elsewhere and accept cross-origin requests; every other portal says the same
  in its own words. So the client needs an API base and the server needs CORS
  with credentials — carrying whatever 11 decided identity travels as.
- ⚠️ **The sharp edge is the session, not CORS** — and it is 11's to resolve,
  which is the whole reason that constraint is written into 11. What is left
  here is carrying the decision out to a second origin and finding out whether
  it was right.
- **Two deploy targets, one repo.** The client is static files; the server is a
  process with a database. They version together and ship apart, which is the
  first time `seq` and the ruleset-versioning compromise have teeth.
- **Size is measured, not feared.** The build is currently ~7.9 MB over 724
  files, against CrazyGames' ≤50 MB initial, ≤250 MB total, ≤1500 files. Comfort
  able on bytes; the file count is already half the cap, and a terrain kit is
  what grows it.

### 13 — Content: units, maps, and the numbers

A track, not a queue — it depends on nothing above and it is what moves the
metrics a portal actually gates on. *Tuning* above is where the numbers and the
argument live; this is the phase that keeps changing them.

- **More unit types.** The catalog is built for this: `Record<UnitTypeId, …>`
  means adding one is a compile error in every table that needs an entry, and
  `maps.test.ts` already checks a new movement type can cross every board. ⚠️
  The one table that will *not* complain is `CHARGE_THRESHOLD`, which is
  `Partial` so artillery can have no row — a new unit silently gets no charge.
- **Whatever play says next.** Three things have already moved this way, and two
  of the three turned out to be rules rather than dials.
- **Maps into a table, and an editor over it.** Settled in *Maps in a table*
  above. The storage half is a migration and a foreign key; the editor is the
  half that makes it worth doing, and it is the first tool in this repo written
  for an author rather than a player. ⚠️ Almost all of it already exists:
  `parseTerrainGrid` reads the rows, `maps.test.ts` already knows what makes a
  board valid — deployable, crossable, one army each way — and `/maps` already
  draws one. An editor is those three joined by a paint tool.
- ⚠️ **"Short, like a game of chess" lands here, and only here.** 11 puts both
  players at the board at once and changes no transport to do it; what it cannot
  do is make the game *end*. Nothing caps a match today — eight units a side, no
  turn limit, and a player who retreats can extend it indefinitely. The dial is
  army size, board size, or a condition that ends it, and which one is a
  **design** question this phase owns rather than a number to quietly tune.

### 14 — Presentation: animation, sound, UI

The other track. ⚠️ `battleResolved.kind` is carried for exactly this and read by
nothing yet — the cutaway was built to branch on it and does not, so a volley
and a charge currently play the same absence of an animation.

- **Model animation in the cutaway**, which is the version 10c deliberately did
  not build.
- **Sound.** Nothing in the codebase makes any, and there is no audio path at
  all — this is a new capability rather than a pass over an existing one.
- **A UI pass.** The board's chrome now reads `--board-*` tokens, so this is
  editing a palette rather than hunting literals. The page's own tokens exist
  and are still used by nothing.
- ⚠️ **The dev handle from *Open questions* belongs here or before it.** Every
  visual change is verified by screenshotting and guessing a pixel, and a
  `tileToScreen` behind `import.meta.env.DEV` turns that into addressing a tile.
  It cost real time twice in one session.

### 15 — Platforms beyond itch

itch is phase 11's target and is not repeated here; this is the portals that
gate, review, or supply their own accounts. Worth attempting only once 13 and 14
have moved playtime and retention — the one portal publishing a bar publishes a
specific one, and the game is judged against it rather than against a portal-wide
average.

- **Per-platform SDK work**, which is mostly identity, room/invite plumbing and
  an ads hook. What each one demands is in the Publishing Pipeline doc.
- **Nobody offers matchmaking**, which *Multiplayer* already accounts for: the
  queue is ours wherever the game runs. What a portal adds here is its own room
  and invite plumbing around it, which is the shape that phase builds anyway.
- ✅ **No exclusivity, decided.** One target is web-exclusive and blocks external
  requests by default; a game with its own server cannot take that deal without
  an exemption, and the deal is worth less than the other portals together. The
  order is itch, then CrazyGames, then whoever else fits — and every
  non-exclusive licence checked so far permits exactly that.
- ⚠️ **The genre is against the grain and this is known going in.** The one
  portal publishing numbers says hypercasual and puzzle dominate, with strategy
  landing with older players; a turn-based keyboard-and-mouse game is not what
  these audiences are built around. Online multiplayer doubles long-term
  retention there, which is the strongest argument for *Multiplayer* preceding
  this phase rather than being deferred to it.
