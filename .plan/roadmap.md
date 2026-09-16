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

**Untuned**, and there are **twenty numbers** of them: the nine of
`BASE_DAMAGE`, the six of `CHARGE_THRESHOLD`, the three of `CHARGE_REPEL`, and
`FLANK_MULTIPLIER` and `REAR_MULTIPLIER`. Plus `LUCK_MAX`, `CHARGE_HALF_LIFE`
and the repel's miss-scaling, which are dials rather than table entries.

#### The first cut

⚠️ **Written down to be argued with, not because they are right.** Nothing has
been played. They exist so the harness has something to print and so tuning
starts from a position rather than a blank table.

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
four-star mountain bought one extra blow or none), the nine matchup numbers
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
no reason to close. At six hits to kill infantry it plainly cannot.

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
contact as at reach, which is the opposite of what `min: 2` exists to say.

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
six-entry threshold table a lot of tuning for something seldom done. That is the
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
| **Session identity** | Opaque id in an httpOnly cookie; the server trusts it on sight | Phase 11 — OAuth sign-in and a real session record. Same cookie, real meaning. No passwords at any point |
| **`actor` under hot-seat** | Server stamps `currentTurn` on its one connection | Phase 11 — session→player map established at join |
| **Matches are unowned and unbounded** | Anyone can create any number; no delete, no expiry. `list()` is capped at 50 newest — a bound, not pagination | Phase 11 — scope listing to the player, and add deletion. Until identity exists there's nothing to scope by |
| **Async play** | Works already — a returning client fetches current state and resumes. What's missing is knowing a match is waiting on you | Phase 11 — match lifecycle and, eventually, notification. Not new mechanics |
| **Ruleset versioning**, and with it **old matches are expendable** | None. ⚠️ `current_state` and `initial_state` are JSON columns with `.$type<GameState>()`, which is a **compile-time cast and no runtime check** — so a match stored before a field existed reads back missing it while the types insist otherwise. A shape change therefore does not migrate rows; it abandons them, and that is **accepted policy until phase 11** rather than an oversight. The dev database is gitignored scratch: delete it. ⚠️ The failure is silent where it matters — a `Unit` with no `health` is `undefined`, and `undefined` arithmetic is `NaN`, so the first symptom is a damage number rather than an error | Stamp a ruleset id on the match so old logs replay under the rules they were played with. That is also what retires the policy above: a match that knows its ruleset can be refused rather than quietly misread |
| **Maps live in code, not a table** | Modules in `server/maps/`; `map_id` is a plain text column with no foreign key. Four of them, picked from at match creation | A `maps` table once maps stop being written by developers. ⚠️ The other condition — enough maps to choose among — has already been met, so this is due a re-read rather than a wait; see below |
| **Elevation is visual only, and capped at 0.5** | Height is a look, never data. A mesa and a bridge deck raise where a unit *stands*, but `shared/` has no idea: there is no height on a tile, `entryCost` never asks about one, and no rule reads one. ⚠️ Both halves of the old technical objection are now gone — `screenToTile` tries every surface height tallest-first, so a click finds a peak where it is drawn, and `surfaceAt` is a lookup that knows each tile's height. What caps height now is the *camera*: at 38.6° a surface at height `h` draws `1.25h` tiles up-screen, and past about half a tile it occupies its neighbour | ⚠️ **Nothing — this is where it stays.** It was once written here as waiting on machinery, which stopped being true when picking learned about height, and elevation as a *rule* is now declined for v1 rather than queued. Mesas are enough at this board size. The reasons, and the two findings worth keeping if it is ever reopened, are in *Out of scope for v1* |
| **Shared build step** | TS source consumed directly, bun-only | A build if the server ever moves off bun |
| ~~**`shared/`'s test files are not typechecked**~~ ✅ **Fixed.** `tsconfig.dev.json` covers `scripts/` and `src/**/*.test.ts` together — see *Testing* in [`architecture.md`](architecture.md). It cost `@types/bun` as a devDependency of the zero-dependency package, and it surfaced **twenty** errors that had been invisible | — |
| **Migrations run at boot** | `migrate()` on startup, fine for one instance and ~0.4 ms once nothing is pending. Drizzle lists runtime migration as a first-class flow for monoliths, so this is a choice rather than a shortcut | `bun run db:migrate` as a deploy step, once there is more than one instance, a rolling deploy, or a reason to deny the runtime DDL rights |
| **Two reads per command** | `resolveActor` needs state to stamp `actor = currentTurn`, but `submit` owns the read | Phase 11 — `resolveActor` becomes a session lookup and the extra read disappears |

### Maps in a table

⚠️ **This condition has already been met, and the decision has not been
re-taken.** It said *revisit when there are enough maps to choose among* —
there are now four, and `StartScreen` picks between them, which is the picker
this section names as what turns maps into a library rather than a constant,
and a library of selectable rows is what a table is for.

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
- **Elevation as a rule.** Height stays presentation only: `surfaceAt` lifts a unit onto a mesa and picking finds it there, but no rule reads a height and no tile carries one. Declined for four reasons, in the order they bite. **Terrain already says it** — `mountain` is `defense: 4` and costs a horse 4, which is "high ground is worth holding and dear to reach" under another name, so a height *defence* bonus would tune one dial twice. **Combat does not exist yet**, and charge and facing are already two original mechanics with untuned numbers; a third interacting axis is the trap this document warns about elsewhere. **The camera caps it** — at 38.6° a surface at height `h` draws `1.25h` tiles up-screen, and a spike showed tile identity collapsing by a full tile, so real relief needs a lower, rotating camera. And **it changes the pace**: "can I get up there" becomes a question on every move, which is Final Fantasy Tactics' game rather than Advance Wars'.

  ⚠️ Two findings worth keeping if it is ever reopened. `entryCost` takes a *destination*; height would make it take a **step**, which is a real signature change but a contained one — `exploreMovement` and `validatePath` are its only callers, and invariant 10 is what guarantees that. And if height ever did enter combat, the door is an **attack** bonus for striking downhill rather than a defence bonus for standing high, because terrain does not express the former and already expresses the latter.
- **Manual routing.** Dragging out a deliberately non-optimal path. Unblocked by the protocol carrying a path and the server validating it — purely a matter of building the UI for it. ⚠️ The substrate now exists and did not before: a route is **pinned, re-pinnable, and drawn as an arrow**, so waypoints have something to hang off rather than needing the whole idea built at once.
- **A blocky / voxel art style.** Tried on a branch with [KayKit's Block Bits](https://kaylousberg.itch.io/block-bits) and rejected — recorded so it is not re-litigated from the screenshots alone. It works: every terrain maps onto a block, and **the autotiler turns out not to be load-bearing** — a cube has no shoreline, so a one-tile river bends through a right angle with no mask arithmetic at all, and `composeTerrain` drops from ~250 lines to ~60. What killed it is the camera. The style lives on block *sides*, a near-top-down board shows only tops, and stepping by whole blocks to expose the sides is the elevation problem above. So it is a real option, but only alongside a different camera — not a swap.


## Remaining phases

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
  phase 11 (*Known compromises*), and luck's flat ordering with the
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

⚠️ **The board's vocabulary gets judged here, and nowhere earlier.** Terrain has exactly two mechanical dimensions — `cost`, which movement reads, and `defense`, which `computeDamage` now reads. So a terrain differing only in `defense` was *indistinguishable in play* until 9c, and one differing only in `cost` mostly duplicates what `river` already is: passable on foot, shut to horse and wheels. That is why renaming `mountain` to something the period would recognise buys accuracy and nothing else, and why new types are worse than nothing until the numbers they differ by are read by something. ⚠️ **And the count is five, not six.** `road` and `bridge` are mechanically the same terrain — `defense: 0` both, `cost: { foot: 1, horse: 1, wheels: 1 }` both — differing only in the character that draws them and the model that renders them. So the question this phase answers is whether *five* distinct terrains give enough tactical variety, which is a different question. Revolutionary-war terrain is a real want — fields, woodlots, orchards, marsh, and stone walls above all — but the first three are a **palette** job that touches no rule (`terrainModels.ts` material overrides), and the last is not a tile at all: a wall gives cover *from one direction*, which makes it an **edge** feature against a grid that only has cells, and it multiplies with facing. Both halves of that belong after this phase can say whether six terrains give enough tactical variety.

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


### 11 — Multiplayer and auth

- **Match lifecycle** — a way for a second person to join, and matches bound to users rather than open to anyone. The largest of the three and still a single bullet: it wants a lobby state, a join mechanism, and the `status` column this section is careful to keep apart from game outcome. Phase 4 was split in two for less; this should be split before it starts.
- **OAuth sign-in** with sessions in our own database — see *Identity* below.
- **Session→player map** at join, so `actor` comes from *who you are* rather than *whose turn it is*.

⬜ **Spike Better Auth before designing around it.** Identity names it the first candidate and names the real unknown in the same breath — "what it assumes about a framework, since `Bun.serve` is not one". That is structurally the same gating question 5c carried about bun's bundler, and 5c is the reason to mark it: a plan built around an unverified assumption had to be rewritten when the spike came back negative. Answer three things first — does it run without a framework adapter, does its cookie replace `vod_session` cleanly, does its Drizzle adapter fit the existing libSQL client — and if any answer is no, the fallback is the thing the section already describes anyway: a `sessions` table of our own plus a small OAuth library.

⚠️ **`owner_id` lands on a table full of unowned rows**, exactly as `'land'` tiles meet phase 6. Nullable column, backfill to a sentinel, or wipe — dev-only data, so wiping is almost certainly right, but it is a step to write down rather than hit.

⚠️ **Decide whether hot-seat survives.** Every match ever played here has been two players sharing one browser, and the moment `actor` comes from the session that stops working by construction. If hot-seat stays, `resolveActor` needs a per-match mode and the whole phase grows a second path through its most security-sensitive function; if it goes, the mode the game was built and tested in disappears with it. Either is fine. Not choosing means discovering the answer while writing the auth code, which is the worst time.

Schema work: `owner_id` on `matches`, a lobby `status` column, and a `sessions` table — three migrations, generated from `schema.ts`. Also **removes a read**: `http.ts` currently loads the match twice per command because `resolveActor` needs state to stamp `actor = currentTurn` while `submit` owns the read. A session lookup needs no state, so the extra read goes with it.

`resolveActor` is the only server change: it stops returning `state.currentTurn` and looks up the session. Client-side, the one function that answers "who is the user" reads it from the session instead of deriving it, and gains an ownership check so a browser doesn't offer units it can't command.

#### Identity

**OAuth only, sessions in our own database. No passwords, ever.**

Sign in with a provider (Discord is the natural fit for a game; GitHub or Google work the same way). Store `(provider, external_id) → player_id`, issue our own session token into a `sessions` table, and resolve it to a `PlayerId` per request.

Never accepting a password deletes the parts of auth that are both hardest and most dangerous — hashing, reset flows, verification email, breach response. We never hold a credential worth stealing. A **magic link** is the natural later addition for people who do not want a third-party account; it keeps the same property.

A small OAuth library plus a sessions table, not an auth platform. Hosted providers (Clerk, WorkOS, Auth0) stay a contained swap if auth ever becomes a distraction.

**Better Auth is the candidate to evaluate first**, because it *is* that description rather than an alternative to it: sessions in our own database, a first-class Drizzle adapter, SQLite supported, httpOnly cookies, OAuth providers, no password path required. It would replace `resolveActor`, supply the `sessions` table, and subsume `withSession` entirely — session creation becomes an insert, which retires the concurrent-mint race rather than working around it.

**The transport does not change** — it is the same cookie the server already sets. What changes is what the session *means*: a row in `sessions` tied to a real player record, rather than an opaque id the server trusts on sight.

Whatever provides identity, **it resolves to a `PlayerId` in one place on the server**, before `actor` is stamped. Auth is a lookup in front of the authority, never something the reducers know about — and game rules never move into the database layer, whatever the store turns out to be.

Until all three land, two tabs share control of both players rather than being two players.

#### Security work that only becomes possible here

**Today there is no authorization, not weak authorization.** `resolveActor` ignores the session and returns `state.currentTurn`, so the cookie gates nothing: any client, with or without one, can submit as whichever player's turn it is, to any match id — and `GET /api/matches` hands out the ids. That's the deliberate hot-seat concession, but it's worth stating in those terms, because several defences are pointless until it changes:

- **CSRF hardening is premature.** `SameSite=Lax` already blocks a cross-site POST from carrying the cookie, and an attacker doesn't need the cookie anyway — there is no authority to forge. Tokens and double-submit patterns become meaningful the same day `resolveActor` starts trusting the session, and not before.
- **`GET /api/matches` becomes an information leak.** It currently lists every match from every visitor. Harmless while matches are unowned; the moment they're owned, listing must be scoped to the player — which is the same change already recorded under Known compromises, arriving for a second reason.
- **`404` on a missing match stops being neutral.** Once matches are owned, "no such match" and "not yours" should be the same response, or the endpoint becomes an existence oracle.

⚠️ The race below is survivable today partly by accident: in dev, Vite serves `index.html`, so the browser's first contact with *our* server is already an API call, and in production the HTML response sets the cookie before any API call can race. If dev ever collapses to one process serving both, that accidental ordering becomes the only thing between us and concurrent cookie-less requests on a cold load — the constraints below would stop being a production-only concern.

**Two constraints on the sessions table, from how the cookie behaves today.** `withSession` mints an id for any request arriving without one, so concurrent requests from a browser with no cookie yet each mint a *different* id and each set it — last write wins. That is not a defect: nothing reads the id (`resolveActor` ignores it) and nothing persists it, so there is no state to corrupt. It becomes one the moment a session store assumes otherwise, which is why the requirements are recorded here rather than worked around in the wrapper:

- **Create session rows at sign-in, not on arrival.** The orphan problem is a *rows* problem. If a row only exists once someone authenticates, the ids a browser mints and discards never become rows, and the race stops mattering without needing to be prevented — which is the only approach that works, since two cookie-less requests are indistinguishable and cannot be serialised.
- **Rotate the id on sign-in.** An id minted for an anonymous visitor must not survive into an authenticated one, or an attacker who plants a known cookie inherits the session after the victim logs in. Standard session-fixation defence, and it makes every pre-auth id irrelevant by construction.

Both are defaults in Better Auth, which is a further point in its favour above.

**Where the check goes.** Whatever provides identity resolves to a `PlayerId` in one place, before `actor` is stamped — see *Identity* above. Ownership is then a lookup in front of the authority, never a rule the reducers know about. Note that `canSelectUnit` deliberately stays a game fact and needs no identity: the server already rejects a command for a unit the actor doesn't own, because `actor === currentTurn` and `unit.owner === currentTurn` compose.

