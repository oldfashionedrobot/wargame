# Wargame — Roadmap and design

Forward-looking only: what is designed but not built. Order is the table
below. What the code does *today* is in
[`architecture.md`](architecture.md); nothing here describes current
behaviour.

---

## Order

**This table is the only place order lives.** Everything below is an *epic* — a
chunk of work, not a step in a sequence — and the sections are in whatever order
they were written in.

⚠️ **A phase number is an identifier, not a position.** The numbers below are
kept because links, commits and cross-references already use them, and they say
nothing about what comes next. Epics added from here on get a **name and no
number**. Reordering is editing one row of this table and nothing else.

| Order | Epic | |
|---|---|---|
| 1 | **Tuning and gameplay tweaks** | Iterate on how it actually plays, before anything is built on top of it |
| 2 | **UI and interaction** | The chrome, and how it feels to give an order |
| 3 | **Presentation** (11) | The 3D look, then animation and sound |
| 4 | **A hosted build** (13) | itch.io — hot-seat, in front of real players |
| 5 | **Multiplayer** (12) | Identity, and two clients in one match |
| 6 | **Content** (14) | More units, maps in a table, an editor |
| 7 | **Platforms** (15) | The portals that gate, review, or supply accounts |

⚠️ **Two ordering constraints are real, and they both end at *Platforms***:
*A hosted build* → *Platforms*, because nothing outward-facing happens without a
build; and *Multiplayer* → *Platforms*, because the portals that supply their
own accounts need somewhere to put them. Everything else is a preference, and
preferences have already changed four times.

⚠️ **Cross-references name an epic rather than number it.** The rule has been
earned twice — inserting a phase once turned six pointers in *Known compromises*
at the wrong thing, and moving *Presentation* to the front broke every surviving
number in the section below. A name survives a reorder; a number is something
somebody has to remember to recount, and nobody does.

## Open questions

- ⚠️ **Nothing can ask where a tile is on screen, and a browser is the only check
  the renderer has.** It is WebGL, so it has no unit tests at all; every visual
  verification therefore means screenshotting, measuring by eye, and clicking a
  guessed pixel. A guess that misses is indistinguishable from a bug, which makes
  the workflow trial-and-error by construction — and it is how a real bug
  (`POINTERPICK`) got found by accident rather than by method.

  The fix is small and already half-built: `anchorTo` projects a tile to screen
  pixels every frame. Exposing that in dev — a `tileToScreen` on the renderer, or
  a `window.__board` handle behind `import.meta.env.DEV` — named for what it
  exposes rather than for the product, so a rename never reaches it — turns every future check
  from *guess a pixel* into *address a tile*. ⚠️ It is test-only surface on a
  production object, which is the reason to think before building it rather than
  the reason not to. *UI and interaction* is where it would pay for itself fastest.


## Known compromises

Deliberate limits of the current design, and what each would take to lift. Distinct from *Out of scope for v1* below, which is unbuilt features rather than accepted limits.

| | Current state | What it needs eventually |
|---|---|---|
| **Session identity** | Opaque id in an httpOnly cookie; the server trusts it on sight | *Multiplayer and auth* — a real session record behind whatever provides identity. Same cookie, real meaning. No passwords at any point |
| **`actor` under hot-seat** | Server stamps `currentTurn` on its one connection | ⚠️ **Not lifted — joined.** Hot-seat is a kept mode, so this stays as one branch and *Multiplayer* adds the other: a session→player map established at join. The cost is that `resolveActor` gains a per-match mode |
| **Matches are unowned and unbounded** | Anyone can create any number; no delete, no expiry. `list()` is capped at 50 newest — a bound, not pagination | *Multiplayer and auth* — scope listing to the player, and add deletion. Until identity exists there's nothing to scope by |
| **Async play** | Works already — a returning client fetches current state and resumes. What's missing is knowing a match is waiting on you | *Multiplayer and auth* — match lifecycle and, eventually, notification. Not new mechanics |
| **Ruleset versioning**, and with it **old matches are expendable** | None. ⚠️ `current_state` and `initial_state` are JSON columns with `.$type<GameState>()`, which is a **compile-time cast and no runtime check** — so a match stored before a field existed reads back missing it while the types insist otherwise. A shape change therefore does not migrate rows; it abandons them, and that is **accepted policy until a ruleset id exists** rather than an oversight. The dev database is gitignored scratch: delete it. ⚠️ The failure is silent where it matters — a `Unit` with no `health` is `undefined`, and `undefined` arithmetic is `NaN`, so the first symptom is a damage number rather than an error | Stamp a ruleset id on the match so old logs replay under the rules they were played with. That is also what retires the policy above: a match that knows its ruleset can be refused rather than quietly misread |
| **Maps live in code, not a table** | Modules in `server/maps/`; `map_id` is a plain text column with no foreign key. Picked from at match creation, and browsable at `/maps` | ✅ **Decided** — a `maps` table plus an editor, in *Content*. ⚠️ The other condition — enough maps to choose among — has already been met, so this is due a re-read rather than a wait; see below |
| **Elevation is visual only, and capped at 0.5** | Height is a look, never data. A mesa and a bridge deck raise where a unit *stands*, but `shared/` has no idea: there is no height on a tile, `entryCost` never asks about one, and no rule reads one. ⚠️ Both halves of the old technical objection are now gone — `screenToTile` tries every surface height tallest-first, so a click finds a peak where it is drawn, and `surfaceAt` is a lookup that knows each tile's height. What caps height now is the *camera*: at 38.6° a surface at height `h` draws `1.25h` tiles up-screen, and past about half a tile it occupies its neighbour | ⚠️ **Nothing — this is where it stays.** It was once written here as waiting on machinery, which stopped being true when picking learned about height, and elevation as a *rule* is now declined for v1 rather than queued. Mesas are enough at this board size. The reasons, and the two findings worth keeping if it is ever reopened, are in *Out of scope for v1* |
| **Shared build step** | TS source consumed directly, bun-only | A build if the server ever moves off bun |
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

- **A `playerEliminated` event.** With two players it states the same fact as
  `gameEnded` twice. It becomes the right shape with three, and is purely
  additive when it comes, because nothing in `GameState` marks elimination for
  an absent event to desync.
- **Transports.** `Unit.position` becomes `{ kind: 'onBoard'; coordinate } | { kind: 'carried'; by: string }` so the invalid state is unrepresentable, with cargo derived by query rather than stored on the transport.
- **Buildings / capture points.** A terrain type with attached `{ owner, captureProgress }`, not a separate object layered on a tile.
- **Elevation as a rule.** Height stays presentation only: `surfaceAt` lifts a unit onto a mesa and picking finds it there, but no rule reads a height and no tile carries one. Declined for four reasons, in the order they bite. **Terrain already says it** — `mountain` is `defense: 4` and costs a horse 4, which is "high ground is worth holding and dear to reach" under another name, so a height *defence* bonus would tune one dial twice. **Two original mechanics are still settling** — charge and facing both shipped, and play has since moved three things to get them sitting right; a third interacting axis is the trap this document warns about elsewhere, and it is a worse bet now there is evidence the first two needed the tuning. **The camera caps it** — at 38.6° a surface at height `h` draws `1.25h` tiles up-screen, and a spike showed tile identity collapsing by a full tile, so real relief needs a lower, rotating camera. And **it changes the pace**: "can I get up there" becomes a question on every move, which is Final Fantasy Tactics' game rather than Advance Wars'.

  ⚠️ Two findings worth keeping if it is ever reopened. `entryCost` takes a *destination*; height would make it take a **step**, which is a real signature change but a contained one — `exploreMovement` and `validatePath` are its only callers, and invariant 10 is what guarantees that. And if height ever did enter combat, the door is an **attack** bonus for striking downhill rather than a defence bonus for standing high, because terrain does not express the former and already expresses the latter.
- **Manual routing.** Dragging out a deliberately non-optimal path. Unblocked by the protocol carrying a path and the server validating it — purely a matter of building the UI for it. ⚠️ The substrate now exists and did not before: a route is **pinned, re-pinnable, and drawn as an arrow**, so waypoints have something to hang off rather than needing the whole idea built at once.
- **A blocky / voxel art style.** Tried on a branch with [KayKit's Block Bits](https://kaylousberg.itch.io/block-bits) and rejected — recorded so it is not re-litigated from the screenshots alone. It works: every terrain maps onto a block, and **the autotiler turns out not to be load-bearing** — a cube has no shoreline, so a one-tile river bends through a right angle with no mask arithmetic at all, and `composeTerrain` drops from ~250 lines to ~60. What killed it is the camera. The style lives on block *sides*, a near-top-down board shows only tops, and stepping by whole blocks to expose the sides is the elevation problem above. So it is a real option, but only alongside a different camera — not a swap.


## The epics

**Order is in the table at the top of this file**, not here. Each section below
is self-contained; read the one you are about to work on.

⚠️ One dependency crosses epics: *Multiplayer* decides matches are meant to be
**short**, and how long a match runs is content. Co-presence puts two people at
the board at the same time; only *Content* makes that a single sitting.

⚠️ **Deploying comes before multiplayer, and the reversal rests on hot-seat
being a real mode.** This file argued the other way for a while, on the grounds
that hot-seat was scaffolding and shipping it would teach nothing true. That
premise is withdrawn: **two people sharing one device is a way to play**, kept
alongside matchmaking rather than replaced by it, and a turn-based game is the
genre where it survives. What follows is that a build can go in front of real
players long before identity exists — and *Tuning* says play is the authority
over both the tables and the harness, so the sooner someone who is not us plays
it, the sooner that epic has anything to go on.

✅ **The old cost disappears and a better position replaces it.** *Multiplayer*
used to have to take *A hosted build*'s constraint as a **prediction** —
designing identity for an origin split that had not happened. It now inherits
that split as a **fact**, already deployed and already exercised. Designing a
session against a second origin you can see is strictly easier than designing
one against a second origin you are anticipating.

⚠️ **The new cost is a public server with no identity on it.** *Known
compromises* records that matches are unowned and unbounded and that
`resolveActor` ignores the session it is handed — accepted limits while the only
audience was us. In front of a portal audience they are an abuse surface rather
than a shortcut, and *A hosted build* has to say what it does about that before
the first upload. It is the one thing the old ordering got for free.

⚠️ **Platform mechanics are not written down here.** They are per-platform,
dated, and change — see the *Publishing Pipeline* doc in Drive, which
carries the gate, exclusivity, identity and size rules for each portal with the
date each was verified. Anything copied into this file is a second copy to keep
in step, and the last audit of this document was mostly about exactly that.

### Tuning and gameplay tweaks

**Iterate on how it plays, before anything is built on top of it.** Graphics,
multiplayer and deployment all add surface to whatever the game currently is;
changing how it plays afterwards means changing them too.

⚠️ **Play is the authority here, not the tables, and not the harness either.**
The harness says what a number does; it cannot say whether a turn is
interesting. Several rules have already moved on evidence from playing rather
than from measuring, and more than one of those turned out to be a *rule*
rather than a dial — which is the shape to expect from this epic too.

⚠️ **The first pass is shipped and the numbers in it are first cuts.** Terrain
weighting, the charge floor and the artillery charge row are all in
`architecture.md` now, at values chosen by printing grids rather than by
playing. ⬜ **They want a pass against real games**, which is the part of this
epic that cannot be done at a terminal. ⚠️ That pass has started returning
verdicts — the flank counter had one and is gone — see *The next combat pass*.

⬜ **What else goes in this epic is not settled.**

#### Known to want attention

- **Match length.** Nothing caps a match: eight units a side, no turn limit, and
  a player who retreats can extend it indefinitely. *Multiplayer* wants a match
  to be one sitting; the dial is army size, board size, or a condition that ends
  it. ⚠️ Listed under *Content* as well, because which of those it turns out to
  be decides where the work lands. ⚠️ **Deeper cover made this worse** — worst
  case went from 5 blows to 6 — and the lever if the two collide is
  `BASE_DAMAGE`, which has room upward and none down: the *no living attacker is
  harmless* sweep binds one point below the lowest row. ✅ **Left uncapped for
  now**, by decision rather than by default — the dials above are what to reach
  for if that changes.
- ⬜ **Healing**, in some form — parked rather than decided, and parked *with*
  capture points: if either comes back, they come back as one design. Nothing
  recovers health today, so a wounded unit is wounded for the rest of the match. ⚠️ It
  sits upstream of the numbers above rather than beside them: cover scales with
  the defender's band and the charge floor only bites near the threshold, so
  both mechanics are most active at low health, and how often units *are* at low
  health is what healing decides.
- ⬜ **Capture points**, sketched and parked: presence is possession, so a point
  is held by standing on it and there is no capture meter to build. ⚠️ **Tied
  to healing** — see above — so neither is designed without the other.
- ⬜ **How much lands before the other player answers.** Uncapped, a whole army
  can fall on one unit before it gets a reply. ⚠️ **That is how the tabletop
  games this is modelled on work**, so it is a dislike rather than a defect —
  but it is the strongest open question about the turn structure.

  ✅ **`ACTIONS_PER_TURN` is settled at `null`, and it was measured rather than
  argued.** One action a turn was played and reverted — the pace was good, and
  artillery ruined it — and the whole dial was then swept with
  `scripts/simulate.ts`. Opener's win share on `classic`, 500 games a cell:

  | budget | opener wins |
  |---|---|
  | all units | 100% |
  | 3 actions | 91.6% |
  | 2 actions | 91.4% |
  | 1 action | 76.4% |

  ⚠️ **Two and three are the same number**, inside the noise at that sample, and
  both are barely nine points off uncapped. The whole movement in the dial is
  between two and one, and even one leaves a twenty-six point first-mover edge.
  There is no setting that buys real counterplay.

  ⚠️ **And capping makes artillery deadlier at *every* level**, which is the
  finding that settles it. Artillery's share of kills over 300 games: **8.9%**
  uncapped, then 20.4%, 17.7% and 21.8% at three, two and one. What was felt at
  a budget of one is a property of *capping*, not of one — a rationed army
  cannot screen or withdraw a wounded unit, so the guns choose freely.

  ⬜ **So the budget is the wrong lever for this, and a *reactive* mechanic is
  the candidate** — which now lives in *Mobility in contact*, below, where
  overwatch and engagement turned out to be one question. The same sweep also says a cautious
  bot would show less first-mover advantage than a greedy one does, which is
  itself a hint that punishing the advance is aimed at the right thing.

  ⬜ Still untried, and the one idea the sweep did not cover: making `hasActed`
  persist until the roster is spent, which gives one-at-a-time pacing *and*
  everyone-acts-once. Bolt Action's order dice are that design, and its units
  have exactly one die each — which is the artillery problem solved at the
  structural level rather than tuned around.

#### Armies, and where they deploy

✅ **The mechanism is built.** An army per player, bound to the player rather than
to an index; a fixed ten-by-two deployment zone with empty squares placing units
inside it; boards validated against the *zone* rather than against one formation;
and the harness taking an army a side. What it does now is in
[`architecture.md`](architecture.md) — what is left is below.

⬜ **Find out whether composition creates playstyles.** This is the question the
mechanism was built for, and it is answered by playing and by sweeping rather
than by reasoning — a sweep to run rather than a design question. ⚠️ **One result already, and it says more about the bot than
about cavalry**: eight horse against the default army loses 200 of 200 on
`classic` *while moving first*. Both sides run the identical policy, so the
asymmetry is real — but a greedy bot never screens, and screening is the
manoeuvre horse needs. Read it as the sweep working, not as a verdict.

⬜ **A zone declared by the map.** `DEPLOYMENT_ZONE` is a constant and every board
is 12×12, so the rows nearest each edge are assumed. The day a map carries its
own, the check in `maps.test.ts` reads it instead of the constant — and the
*shape* of a deployment area becomes a board's design rather than a global. That
belongs with *Content*, where maps become data. **Parked.**

⬜ **Validation that answers rather than throws.** `createMatchState` throws on an
army that is not the zone's size and `parseArmyGrid` throws on an unknown
character, which is right for a server-side constant and wrong for a
*client-supplied* army — it would be a 500. The `{ ok, reason }` shape
`validateCommand` already uses is what `POST /api/matches` needs before it can
accept one, along with a column if an army is ever worth displaying. **Parked
with the builder**, which is the only thing that needs it.

⬜ **The builder is UI**, and belongs with *UI and interaction*. Until it exists an
army is an argument, which is enough for the harness and for a hot-seat match
started from a constant. **Parked**, and so is the pricing below.

⚠️ **It made roster size a variable**, which *Match length* above names as one of
its three dials. The two want reading together now that the two sides can differ.

⚠️ **The pricing half is *Content*'s** — a cost column, a budget constant, and one
more clause in the validation above.

#### The next combat pass

**Landed, all but the charge thresholds.** The pass went at one finding. Per hit,
this game was *not* more lethal than Advance Wars: on open ground the median kill
took three hits here against AW's two, and in cover each star is worth half again
what it is there. It *played* far more lethal for three reasons the damage table
was not one of — artillery dealt over half of all damage and was never answered,
only one shot in ten drew a reply, and charges finished whatever had been wounded.
Contact, luck scaled in with its rolls recorded, the flank counter cut and
artillery's new row are all in [`architecture.md`](architecture.md); what is left
here is tuning the charge against them.

⬜ **The charge as a gamble or a finisher, not a routine.** Lower
`CHARGE_THRESHOLD`, so a charge is either a long shot at a healthy unit or close
to certain against a broken one, and seldom anything between. A candidate, with
every entry down by about a third, on open ground:

| | at 70 health | at 50 | at 30 |
|---|---|---|---|
| cavalry → infantry, head-on | 13% → 8% | 31% → 20% | 79% → 50% |
| cavalry → infantry, flank | 22% → 11% | 55% → 27% | 100% → 69% |
| cavalry → infantry, rear | 40% → 16% | 100% → 40% | 100% → 100% |

✅ **Tuned after contact, not ahead of it.** The charges that succeeded were
mostly from the flank and rear — a rear charge on a half-strength line is
certain — and contact removes most of those approaches on its own. Lowering the
thresholds first would have been lowering them twice.

⚠️ **"High risk" lives in the other table.** A failed charge costs
`CHARGE_REPEL` plus up to 9: between 5 and 19 points. The threshold says how
*likely* a charge is; if a failed gamble should hurt, the repel is the number
that says so — or being caught, now that contact pins the charger where it
stopped.

⚠️ **What contact did for the charge.** The charge is modelled on the real
thing: cavalry cannot walk into musket range and trade blows with formed infantry
— 30 out against 50 back — so it waits for an opportune moment and charges to
break the unit outright, and if the line holds the horses are stopped on the
bayonets. Contact supplies both halves the rules lacked. Opportunity is scarce
again, because a flank is no longer one move away; and a failed charge leaves the
cavalry caught — stay and lose the exchange, renew the charge, or withdraw and do
nothing. That is the *high risk* half arriving without touching `CHARGE_REPEL`,
and a reason the thresholds may need less lowering than they would on their own.

⬜ **Parked for a later pass: a charge's odds scaling with the charger's own
strength.** `chargeChance` reads the defender's health and never the attacker's,
so a broken squadron breaks a fresh line exactly as often as a fresh one does.
Not this iteration.

✅ **The whole pass, prototyped and measured together** in a scratch copy:
contact, scaled luck, the artillery row, the flank removal and the rolls column.
The migration it generates is one additive line, `ALTER TABLE resolutions ADD
rolls text`. Exactly three existing tests fail, all three the ones this plan
retires — the flat luck spread and the two flanked counters. Against today, 300
games a map, blue opening:

| | artillery's share of damage | charge success | shots answered |
|---|---|---|---|
| `classic` | 56% → 47% | 81% → 72% | 10% → 11% |
| `crossroads` | 43% → 35% | 77% → 70% | 10% → 13% |
| `common` | 53% → 40% | 78% → 70% | 10% → 12% |
| `lakeland` | 58% → 48% | 72% → 62% | 11% → 14% |

The artillery cut more than pays back what contact pushes the other way, and
charge success falls ten points before a single threshold moves — so the
thresholds likely need less lowering than first assumed.

⚠️ **Contact looks like it rewards moving second.** On `common` the second mover
wins from both openings — 63% when blue opens, 67% when red does — where today
it is near even; `classic` and `crossroads` lean the same way, mildly. The
likely reason is the rule doing what it says: whoever advances into contact
first is pinned and answered first. The bot always advances, which a human need
not, so this is a thing to watch in play rather than a verdict. ✅ **Accepted
for now**: the first mover still gets its volley off before contact is made, and
tuning options wait on how it plays.

⚠️ **`lakeland`'s stalls are not this pass's doing.** It leaves exactly 16.3% of
games unfinished under today's rules, under contact alone, and under the whole
pass — the same 49 of 300. A count that survives every combat rule changing
belongs to the board or its movement costs, and wants looking at on its own.
**Not pursued**: `lakeland` is not a good board, and the maps are due a redesign
regardless.

#### Mobility in contact — engagement and overwatch

✅ **Contact shipped.** A unit beside an enemy is in contact; moving into contact
ends the move, and a unit that starts its action in contact moves or attacks, not
both. What it does is in [`architecture.md`](architecture.md), under *Movement*
and *Contact*; why, and what it measured, is in the commit that landed it.

⚠️ **Engagement and overwatch were one question**: both answer *moving around
near the enemy should cost something*. Contact made the fight itself costly to
manoeuvre in; overwatch would make moving merely *near* the enemy costly.

⬜ **Overwatch is shelved, as a possible second layer.** Contact covers a unit
that is in a fight; overwatch would add a cost to moving *near* the enemy without
contact, which this rule does not ask for, and so would a free blow for leaving.
Kept as designed, in case play says otherwise:

⬜ **Overwatch — spend the attack to watch instead.** A unit forgoes its shot
and names a direction to watch; an enemy entering that arc is fired on before
it acts. XCOM's shape rather than 40k's, and it composes with facing, which
already exists and already decides whether a shot is answered.

⚠️ **`slow` excludes artillery from it for free.** A gun may move or attack
but never both, and never answers a shot — so the two arms that can overwatch
are precisely the two the budget sweep kept buffing guns against. The
counterweight costs no new rule.

⬜ **Three decisions, cheapest first.** Whether it consumes the action — it
should, or it is a passive buff rather than a trade. Whether it watches a
named arc or the whole range band, where the band is free because
`tilesInRange` already honours artillery's minimum, so enemies can walk
*under* the guns. And whether it triggers on the destination or anywhere
along the path: the destination is one more battle in the same command, while
*through* means walking the path step by step and deciding whether the mover
stops, which touches `validatePath` and the one-event-carries-a-path design.
Prove it on the destination first.

⚠️ **The sharp edge is randomness, not the rule.** `rollLuck` reads the
*command* and never the rules, deliberately — so the number of draws cannot
depend on whether a path crossed a watched tile. The existing precedent is to
draw for the worst case: a counter roll is already drawn whether or not it is
used. It also needs watching state on `Unit`, which is a `GameState` shape
change and abandons stored matches under the ruleset compromise.

⚠️ **The reactive family is unmeasured, and structurally so.** A zone is worked
out from positions alone, so a scratch search can say what it does; a reaction
depends on what the other side chose to watch, which nothing can sweep without
building it.

#### The dials

The tables are `BASE_DAMAGE`, `CHARGE_THRESHOLD` and `CHARGE_REPEL`; the scalars
beside them are `TERRAIN_WEIGHT`, `FRONTAL_FLOOR`, `FLOOR_PER_STAR`,
`FLANK_MULTIPLIER`, `REAR_MULTIPLIER`, `LUCK_MAX`,
`CHARGE_HALF_LIFE` and `REPEL_DIVISOR`. The `defense` column of `terrain.ts` is
a dial too, and turned out to be the one carrying the most weight.

**Tune against the harnesses, never against a damage number.**
`scripts/matchups.ts` prints hits-to-kill across every matchup and terrain,
`charges.ts` prints charge odds for all three approaches on every depth of
cover, and `server/scripts/simulate.ts` plays the game against itself and
reports outcomes, match length, damage and kills by unit type, and whether each
mechanic fired. ⚠️ **All three have earned themselves** — one killed a table
where everything died in two hits, another found cavalry-into-artillery
saturating at the flank on its opening run, the hits-to-kill grid showed that a
wood was worth literally nothing, and the simulator settled the turn budget in
an afternoon.

⚠️ **Read the simulator's mechanic counts before its win rates.** A bot
confirms whatever it is scored on: the greedy one subtracts the expected
riposte from its own score, so it reports counters landing in a tenth of
exchanges, which is the bot avoiding them rather than a fact about counters.
⚠️ **It cannot say whether cover is well placed**, and will not until a bot
values ground: it never *chooses* terrain, so what it reports is where fights
happened to land rather than what either side thought ground was worth.
⚠️ **What it will say is whether cover is anywhere near the fighting**, and that
turned out to be worth having — moving the boards' broken ground off the
deployment edges and into the contested middle took hits landing on cover from
under one percent to **9% on `common` and 16% on `lakeland`**, with no change to
the bot at all. A number that low is a board nobody fights over; it is a
geometry check, not a verdict on the terrain.
⚠️ **What it says robustly is asymmetry**: both sides run the identical policy,
so any departure from an even split is the map or the deployment rather than
the bot.

⚠️ **A star is worth a percentage and hits-to-kill is an integer**, so most
single-star changes sit below the resolution of the system and read as no change
at all. This has fooled the document twice. Print the grid.

### UI and interaction

**The chrome, and how it feels to give an order.** Split out of *Presentation*
and put in front of it: models and audio are a different job from the surface a
player actually operates, and this is the one they meet first. ⚠️ **Named, not
numbered**, per the rule at the top of this file.

⬜ **The scope is half-known.** What follows is the part already identified; the
interaction half is meant to be filled from **playing**, not from reasoning at a
terminal, and it is deliberately short until then.

- **A UI pass.** The board's chrome reads `--board-*` tokens, so this is editing
  a palette rather than hunting literals. ⚠️ The *page's* own tokens exist and
  are used by nothing — a second set that never got adopted, which is either a
  job to finish or a thing to delete.
- **Graying out acted units.** ⚠️ **Moved here out of *Out of scope for v1***,
  where it no longer belongs: the mechanical restriction is built and only the
  visual is missing, which is precisely this epic. *Multiplayer* separately
  wants a "your units that can still act" indicator — the same thing under
  another name, so it should be **one** treatment rather than two.
- ⚠️ **The dev handle from *Open questions* belongs here**, and this is now the
  first epic where it pays. Every visual change is verified by screenshotting
  and guessing a pixel; a `tileToScreen` behind `import.meta.env.DEV` turns that
  into addressing a tile. It has cost real time more than once, including a
  check abandoned rather than finished.

⚠️ **Interaction is where play is the authority, the same as tuning.** The
usability work already done was found by reading the code; what is left will be
found by someone using it, which is why this epic sits behind *Tuning* and in
front of everything that adds surface.

### 11 — Presentation

A track, pulled to the front because a graphics pass is wanted before the
plumbing. Nothing in the queue depends on it and it depends on nothing.
⚠️ **UI left this epic** — see *UI and interaction*, which runs before it.

**Split in two, and 11a comes first on its own.**

#### 11a — The 3D look

Models, textures, materials, lighting, shading, rendering. ⬜ **The style is
undecided.** Low-poly PS1 is what is being explored; nothing is settled, and
nothing below assumes it.

Three facts about the current setup that constrain whatever is chosen:

- ⚠️ **An orthographic camera makes affine texture mapping a no-op.** It is one
  of the two signatures of the PS1 look — textures swimming on oblique polygons
  — and it comes from UVs being interpolated without a perspective divide. Under
  ortho there is no divide to skip: `w` is 1 everywhere, so perspective-correct
  and linear interpolation are the same thing. Getting that effect means a
  perspective camera, and the camera is load-bearing for reading the board.
- ⚠️ **Nothing is textured.** The kit models arrive untextured and near-white and
  the materials are flat colours, so anything texture-borne — dither patterns,
  paletted crunch, point-sampling shimmer — is an art job before it is a shader
  job.
- ⚠️ **Whether to add shadows is a style question, not a default.** This section
  previously called a directional light and a shadow generator "the largest
  single change available", which is true of a realistic target and wrong of a
  period one — the PS1 had vertex lighting and blob shadows and no shadow maps
  at all. `UNIT_GLOW` exists to prop up silhouettes the hemispheric light does
  not give, and whether it comes out depends on which way this goes.

⚠️ `battleResolved.kind` is carried for exactly this and read by nothing yet —
the cutaway was built to branch on it and does not, so a volley and a charge
currently play the same absence of an animation.

#### 11b — Animation and sound

- **Model animation in the cutaway**, which the cutaway was built to branch on
  and does not.
- **Sound.** Nothing in the codebase makes any and there is no audio path at
  all — a new capability rather than a pass over an existing one.

⚠️ **The UI pass that used to live here is its own epic now**, and it runs
first. Chrome and the feel of giving an order are a different job from models
and audio, and the one that a player meets before either.

### 12 — Multiplayer: identity, and two clients in one match

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

✅ **Hot-seat is kept, not removed.** This section argued the other way — that
it was scaffolding and two browser tabs are two players. It is a way to play:
two people at one device, shipped in *A hosted build* and still wanted after
this epic lands. ⚠️ **The cost that argument named is now simply the price**: a
per-match mode on `resolveActor`, in the most security-sensitive function here.
It is paid deliberately, and the seam below is where — hot-seat was already
listed as one of the three providers, so the machinery is the machinery.

✅ **One thing gets cheaper.** Every test and manual check in the repo is
written in hot-seat. Removing it was a real edit to the suites; keeping it means
they go on describing a mode that still exists.

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

#### How identity travels — a bearer token, decided

**`Authorization: Bearer <token>`. No cookie, on any platform.** The client is
served from a portal's origin and the server is ours, and a cookie cannot
survive that reliably: `SameSite=Lax` is not sent cross-site at all, `None`
alone is blocked by Safari's third-party rules, and `Partitioned` only came back
to Safari in **26.2 (12 December 2025)** after being pulled in 18.5 — so every
older iOS device gets no session. A header is not subject to any of it.

⚠️ **This is not a compromise dressed up.** A header attached deliberately is
never sent automatically, so **CSRF stops being a category** rather than needing
a defence. The thing it gives up — httpOnly, which no script can read — is
addressed below by making the token worth very little rather than by hiding it
better.

**Three providers, one seam.** `resolveActor` becomes *verify a token, produce a
`PlayerId`*, and what differs is who mints and who stores:

| provider | who mints | who stores it | verified by |
|---|---|---|---|
| **guest** — itch, and our own site | us | the client, in `sessionStorage` | a row in our `sessions` table |
| **crazygames** | CrazyGames | **nobody** | their signature |
| **oauth** — later, if wanted | us, after the dance | the client, same as guest | our `sessions` table |

⚠️ **The middle row is the one worth reading twice.** CrazyGames' `getUserToken()`
returns a JWT carrying `userId`, lasts an hour, is refreshed by the SDK, and
their docs say **not to store it — call the method again when you need one**. We
verify it against
[their public key](https://sdk.crazygames.com/publicKey.json) and hold nothing.
So on that platform we store no credential, mint no credential, and can leak
none. ⚠️ Their account-integration requirement stops being a cost and becomes
the thing that removes our storage problem.

⚠️ **And the platform with the storage risk is the platform with nothing worth
storing.** itch has no accounts to integrate, so the guest token stands behind
no email, no OAuth grant, no profile — stealing one buys the ability to move
pieces in somebody's free wargame. That symmetry is what makes the decision
comfortable rather than merely necessary.

⚠️ **"Security is the platform's responsibility" is half true, and the other
half is ours.** True on CrazyGames, literally: they mint, they refresh, we check
a signature. Not true on itch, where there is no platform identity at all — and
the part that is always ours is the **blast radius**. A stolen token should be
worth as little as possible, which means short expiry, rotation, and never
carrying anything but an id.

#### Where the guest token lives

**`sessionStorage`, not `localStorage`**, and the difference is not cosmetic.
Every itch HTML5 game is served from one shared origin —
`html-classic.itch.zone`, with no per-game isolation and
[itch saying they will not add it](https://itch.io/t/3099694/notice-for-html-game-devs-upcoming-change-to-cdn-domain)
— so anything in `localStorage` is readable by **any other game on itch,
forever**. `sessionStorage` is partitioned by origin *and tab*, survives
reloads, and dies with the tab.

| | readable by another itch game | survives |
|---|---|---|
| `localStorage` | any game, any tab, any time | forever |
| `sessionStorage` | only a game loaded into the **same tab afterwards** | tab close |
| in memory | nobody | page reload |

⚠️ **It narrows the window rather than closing it**, and the standards say
plainly that nothing closes it: [RFC 10017, *OAuth 2.0 for Browser-Based
Applications*](https://www.rfc-editor.org/info/rfc10017/) recommends a
backend-for-frontend precisely so tokens never reach the browser — which works
because the frontend and the BFF are same-site, the one property a portal takes
away. Its advice for everyone else is to keep tokens in memory where practical
and accept that same-origin script can still take them.

⚠️ **The session shape is the argument, not a consolation.** A match is one
sitting in one tab, like a game of chess. Storage that dies with the tab is that
same sentence, and a token that expires in minutes makes the remaining window
worth little.

#### The seam, and what is still open

⚠️ **`PlayerId` already means something, and it is not a person.** It is
`string`, and in practice `'player-blue'` — a **seat**, and every match has one.
`Unit.owner: PlayerId` means *owned by the blue seat*, which is right: the
rulebook must never know people exist. ⚠️ **So a session resolves to a person,
and the person's seat *in this match* is the `PlayerId`** — two lookups and two
concepts, where this section used to say "session→player map" as though it were
one. Because `PlayerId` is a bare alias, a person-id would typecheck as a seat
today and nothing would complain.

⚠️ **Exchange at the door, rather than verifying per request.** Each platform
gets **one endpoint, called once**, which trades its credential for ours:

```
POST /api/auth/guest                        → { token }
POST /api/auth/crazygames { platformToken } → { token }
```

After that every request carries our token and **the server never branches on
platform again** — `resolveActor` is one lookup. Adding a platform is one
endpoint plus one client shim; the hot path of every command and every poll is
untouched, and the thing most likely to rot is confined to a file called once.
⚠️ The cost is real: on CrazyGames we would hold our own token rather than
re-asking their SDK, which gives up the *we store nothing* property. Simplicity
was judged worth it, and re-establishing after an expiry is the same code as
establishing.

⚠️ **A platform is an identity provider, and the schema should not know the
difference.** `('crazygames', theirUserId)` and `('google', sub)` are the same
row shape. Only guest is special — a player with no `accounts` row:

```
players   id, created_at, display_name
accounts  provider, external_id, player_id    -- PK (provider, external_id)
sessions  token, player_id, expires_at
```

⚠️ **The test for whether the seam is in the right place:** could CrazyGames be
added by writing one endpoint and one client module, touching nothing else? Build
for that, and ship only `guest` — itch needs no more, and building the second
provider speculatively is how a seam ends up the wrong shape.

**Four choices left open, in the order they bite:**

1. ⬜ **Does a guest survive the tab?** `sessionStorage` dies with it and is
   invisible to other itch games in other tabs; `localStorage` survives and is
   readable by any itch game forever. The case that decides it is refreshing
   mid-match. *Leaning `sessionStorage`, at the cost of losing a match to a
   closed tab.*
2. ⬜ **`UserId` split from `PlayerId`?** Cheap now, horrible later, and the
   bare `string` alias is why. *Leaning: split before any identity code lands.*
3. ⬜ **Provider chosen at build time or at runtime?** Build time
   (`--mode crazygames`) ships no unused SDK, makes the seam provably one file,
   and lets tests use the guest provider for real; runtime (`if
   (window.CrazyGames)`) is one build everywhere but puts every platform's SDK
   in every build, which fights the file-count budget and Poki forbids outright.
   *Leaning build time, with the least confidence of the four.*
4. ⬜ **What the queue matches on** — see *How two people meet*. A FIFO pair-off
   until map choice or a rating exists, neither of which does.

**The work, in three parts:**

- **Match lifecycle** — a way for a second person to join, and matches bound to
  users rather than open to anyone. The largest of the three and still a single
  bullet: it wants a lobby state, a join mechanism, and a `status` column. It
  should be split before it starts.

  ⚠️ **Keep game outcome separate from lobby status.** An outcome is a fact about
  the board — produced by a reducer, replayable from the log — so it belongs in
  `GameState`. *Waiting for an opponent to join* is about **users**, belongs on
  the `matches` row, and no reducer should know about it. One `status` field
  spanning both is the muddle to avoid.
- **Guest identity**, with sessions in our own database. Sign-in is the later
  upgrade — see *Identity* below, and the seam above.
- **Session→player map** at join, so `actor` comes from *who you are* rather
  than *whose turn it is*.

⚠️ **Two bits of UI will need to know who the user is** — a *your units that can
still act* indicator, and a victory screen saying *You won* rather than *Blue
won*. Both should read it from one function rather than inlining
`state.currentTurn` at each call site. Selection does not need it:
`canSelectUnit` is a game fact, and the server already rejects a command for a
unit the actor does not own, because `actor === currentTurn` and
`unit.owner === currentTurn` compose.

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
  "does its cookie replace `wargame_session`" but "can its cookie carry the
  attributes we need" — and once *How identity travels* settled on a bearer
  token, on **its bearer plugin instead**. Its docs caution that the plugin is
  for APIs which cannot use cookies. We are one, for a reason outside our
  control.

⚠️ **And it already implements the decision at the top of this phase.** The
[anonymous plugin](https://better-auth.com/docs/plugins/anonymous) is
guest-by-default and account-by-choice as a supported path, not a pattern to
assemble: `/sign-in/anonymous`, `/anonymous/link`, and an `onLinkAccount`
callback for carrying a guest's matches onto the real account when they sign in.
Google is then a config block and a redirect route.

⚠️ **But it is not this phase's problem, and the earlier version of this note
was wrong to say so.** That argued for adopting it first, because hand-rolling
and migrating later would build the session system twice. That reasoning assumed
*Multiplayer* needed OAuth. It does not: itch has no accounts, CrazyGames supplies
its own, and the guest path is *mint a random token, store a row, verify a
header* — tens of lines, not a system. Better Auth earns its place the day
somebody wants to sign in and keep an identity across devices, and that day is
not in this phase.

⚠️ **The cost, when that day comes, is that it owns the schema**: its
`user`/`session`/`account` tables instead of ours. Migrating guest rows into its
anonymous users is a contained job precisely because there is so little of
ours.

⚠️ **The verification this once listed is void**: it asked whether
`defaultCookieAttributes` reaches `Partitioned`, and there is no cookie any
more. What would need checking on the day Better Auth is adopted is its bearer
plugin against the exchange shape below — not before.

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

⚠️ **`owner_id` lands on a table full of unowned rows.** Nullable column, backfill to a sentinel, or wipe — dev-only data, so wiping is almost certainly right, but it is a step to write down rather than hit.

⚠️ **Hot-seat stops working by construction** the moment `actor` comes from the session — every match ever played here has been two players sharing one browser. ⚠️ **And it is a shipped mode**, sent out in *A hosted build* before this epic starts, so it cannot simply lapse: `resolveActor` gains a per-match mode, which is a second path through the most security-sensitive function here. That cost is decided rather than open — see the top of this epic — and the thing not to do is discover the shape of it while writing the auth code.

Schema work: `owner_id` on `matches`, a lobby `status` column, and a `sessions` table — three migrations, generated from `schema.ts`. Also **removes a read**: `http.ts` currently loads the match twice per command because `resolveActor` needs state to stamp `actor = currentTurn` while `submit` owns the read. A session lookup needs no state, so the extra read goes with it.

`resolveActor` is the only server change: it stops returning `state.currentTurn` and looks up the session. Client-side, the one function that answers "who is the user" reads it from the session instead of deriving it, and gains an ownership check so a browser doesn't offer units it can't command.

#### Identity — when signing in eventually arrives

⚠️ **Not in this phase.** itch needs no login and CrazyGames brings its own; what
follows is the shape for the day somebody wants an identity that outlives a tab.

**OAuth only, sessions in our own database. No passwords, ever.**

Sign in with a provider (Discord is the natural fit for a game; GitHub or Google work the same way). Store `(provider, external_id) → player_id`, issue our own session token into a `sessions` table, and resolve it to a `PlayerId` per request.

Never accepting a password deletes the parts of auth that are both hardest and most dangerous — hashing, reset flows, verification email, breach response. We never hold a credential worth stealing. A **magic link** is the natural later addition for people who do not want a third-party account; it keeps the same property.

A small OAuth library plus a sessions table, not an auth platform. Hosted providers (Clerk, WorkOS, Auth0) stay a contained swap if auth ever becomes a distraction.

**Better Auth is the candidate and the spike came back green** (above), because it *is* that description rather than an alternative to it: sessions in our own database, a first-class Drizzle adapter, SQLite supported, OAuth providers, no password path required, and guest-to-account as a supported plugin. It would replace `resolveActor`, supply the `sessions` table, and subsume `withSession` entirely — session creation becomes an insert, which retires the concurrent-mint race rather than working around it.

**It would issue a bearer token, not a cookie** — see *How identity travels*, which settles that for every provider. What sign-in changes is what the token *means*: a row tied to a real person rather than a guest that dies with the tab.

Whatever provides identity, **it resolves to a `PlayerId` in one place on the server**, before `actor` is stamped. Auth is a lookup in front of the authority, never something the reducers know about — and game rules never move into the database layer, whatever the store turns out to be.

Until all three land, two tabs share control of both players rather than being two players.

#### Security work that only becomes possible here

**Today there is no authorization, not weak authorization.** `resolveActor` ignores the session and returns `state.currentTurn`, so the cookie gates nothing: any client, with or without one, can submit as whichever player's turn it is, to any match id — and `GET /api/matches` hands out the ids. That's the deliberate hot-seat concession, but it's worth stating in those terms, because several defences are pointless until it changes:

- ~~**CSRF hardening**~~ ✅ **Not needed, and not because it is premature.** It was premature only while there was no authority to forge; the reason it stays unnecessary is that identity moved to an `Authorization` header, and a header attached deliberately is never sent automatically by a browser. There is no cross-site request to forge with. ⚠️ **CORS is still worth getting right** — it is what stops another origin *reading* a response — but it is no longer standing in for a missing CSRF defence.
- **`GET /api/matches` becomes an information leak.** It currently lists every match from every visitor. Harmless while matches are unowned; the moment they're owned, listing must be scoped to the player — which is the same change already recorded under Known compromises, arriving for a second reason.
- **`404` on a missing match stops being neutral.** Once matches are owned, "no such match" and "not yours" should be the same response, or the endpoint becomes an existence oracle.

**Two constraints on the sessions table, and moving to a bearer token retires the first one.** `withSession` today mints an id for any request arriving without one, so concurrent cookie-less requests each mint a *different* id and each set it — last write wins. ⚠️ **A token the client asks for explicitly has no such race**: minting stops being something that happens incidentally to any request, and becomes one endpoint the client calls once. The constraint is recorded anyway, because it is the reason that shape is right rather than an accident of it:

- **Create session rows at sign-in, not on arrival.** The orphan problem is a *rows* problem. If a row only exists once someone authenticates, the ids a browser mints and discards never become rows, and the race stops mattering without needing to be prevented — which is the only approach that works, since two cookie-less requests are indistinguishable and cannot be serialised.
- **Rotate the id on sign-in.** An id minted for an anonymous visitor must not survive into an authenticated one, or an attacker who plants a known cookie inherits the session after the victim logs in. Standard session-fixation defence, and it makes every pre-auth id irrelevant by construction.

Both are defaults in Better Auth, which is a further point in its favour above.

**Where the check goes.** Whatever provides identity resolves to a `PlayerId` in one place, before `actor` is stamped — see *Identity* above. Ownership is then a lookup in front of the authority, never a rule the reducers know about. Note that `canSelectUnit` deliberately stays a game fact and needs no identity: the server already rejects a command for a unit the actor doesn't own, because `actor === currentTurn` and `unit.owner === currentTurn` compose.

### 13 — A hosted build on itch.io

**itch.io.** Open, no gate, no review, no exclusivity, and no accounts to
integrate — so it is the one portal where "does this deploy at all" can be
answered without also answering anything else. Everything below is what itch
specifically requires; the other portals want a superset.

**What ships is hot-seat**, which is a mode rather than a placeholder — two
people at one device, and a turn-based game is the genre where that survives.
No new mechanics: it is the deploy story, and it is the smallest epic here.

✅ **It goes before *Multiplayer*, and that makes it smaller rather than
larger.** The decision it would otherwise have had to borrow — how identity
crosses an origin — does not arise, because there is no session yet. It needs
plain CORS and an API base, not CORS with credentials. *Multiplayer* then builds
its session against an origin split that is already deployed and already
exercised, instead of one it has to anticipate.

⬜ **What it does have to answer is the one thing the old ordering got for
free**, and a review sharpened it into two items rather than one.

1. ⚠️ **There is no authorization, and `GET /api/matches` is its index.**
   `resolveActor` returns `state.currentTurn` whoever asks, so any client can
   play **both sides** of any match — and the list endpoint hands out every
   match id unauthenticated, so nothing has to be guessed. A uuid v4 would be
   unfindable on its own; the list is what makes this trivial rather than
   theoretical. The cheapest fix that changes the shape is scoping the list to
   the caller's session, which needs sessions to mean something — so it is
   really the question of how much of *Multiplayer*'s identity work has to
   come early.
2. ⚠️ **Nothing bounds creation.** `POST /api/matches` has no rate limit, cap,
   expiry or delete, and each match stores a whole `GameState`; the event log
   grows per command with no ceiling either. A loop fills the disk, and SQLite
   on a small persistent volume is the failure mode.

⬜ Decided before the first upload, not after.

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
  in its own words. So the client needs an API base and the server needs CORS.
- ⚠️ **Plain CORS, not CORS with credentials**, because there is nothing to
  credential yet. The sharp edge was always the session rather than the headers,
  and going first is what defers it: *Multiplayer* resolves it later, against a
  second origin that by then is a fact rather than a forecast.
- **Two deploy targets, one repo.** The client is static files; the server is a
  process with a database. They version together and ship apart, which is the
  first time `seq` and the ruleset-versioning compromise have teeth.
- **Size is measured, not feared.** The build is currently ~7.9 MB over 724
  files, against CrazyGames' ≤50 MB initial, ≤250 MB total, ≤1500 files. Comfort
  able on bytes; the file count is already half the cap, and a terrain kit is
  what grows it.

### 14 — Content: units, maps, and the numbers

A track, not a queue — it depends on nothing above and it is what moves the
metrics a portal actually gates on. *Tuning and gameplay tweaks* is where the numbers and the
argument live; this is the phase that keeps changing them.

- **More unit types.** The catalog is built for this: `Record<UnitTypeId, …>`
  means adding one is a compile error in every table that needs an entry, and
  `maps.test.ts` already checks a new movement type can cross every board. ⚠️
  The one table that will *not* complain is `CHARGE_THRESHOLD`, which is
  `Partial` so artillery can have no row — a new unit silently gets no charge.
- **Whatever play says next.** Three things have already moved this way, and two
  of the three turned out to be rules rather than dials.
- ⬜ **The boards still lean, and the gun's mobility moves them more than they
  do.** Running `simulate.ts` with the same policy on both sides — so any
  departure from even is the board — and playing every map from both openings,
  300 games a cell:

  | map | blue opens | red opens | reads as |
  |---|---|---|---|
  | `crossroads` | 52% blue | 50% blue | even |
  | `common` | 51% blue | 56% blue | near even |
  | `meadow` | 67% blue | 53% blue | leans blue |
  | `classic` | 59% blue | 69% blue | a blue board |
  | `two-bridges` | 68% red | 73% blue | whoever moves **second** |
  | `lakeland` | 54% red | 57% red | a red board, 16% unresolved |

  ⚠️ **Read the pair, not either column.** A fair board gives the opener the same
  edge from both ends; one colour winning *both* columns is the board talking.
  By that test `crossroads` and `common` are sound, `classic` and `lakeland` are
  biased, and `two-bridges` is order-sensitive rather than biased — it rewards
  replying, from either side, which is a property of its chokepoints.

  ⚠️ **`lakeland` does not finish a sixth of its games**, which is worth more
  attention than its bias: a board that cannot resolve is a worse failure than
  one that favours a colour, and the lake is the obvious suspect.

  ⚠️ **Artillery's `movementRange` was the biggest single lever on all of this**,
  and it is measured rather than argued. At **4** the same six boards handed the
  game to whoever moved *second* — 94% on `crossroads` and `meadow`, 89% on
  `two-bridges`, a spread of 54% to 95%. At **3** the spread is 50% to 73% and
  the second-mover effect survives only on `two-bridges`. `wheels` pays 1.5 for
  plains against 1 for road, so the gun's budget decides how much board it
  covers between replies, and a road network amplifies whatever that number is.
  ⚠️ **So settle the gun before redrawing a board to chase a number** — the
  terrain is downstream of it.

  ⚠️ **Do not tune these against the bot.** It is greedy, it never screens, and
  it does not value terrain — so chasing an even split optimises the board for a
  player nobody is. The numbers are a floor: a board where one side wins 100% is
  broken, and none of these is that.

  ⚠️ **A map is a balance surface, not just content**, which is the argument for
  the editor rather than against it: the fastest way to fix a board is to be able
  to change it and re-run.

- ⬜ **An army budget.** Every unit type gets a cost; a player spends a fixed
  budget on what they field. ⚠️ **Warhammer's answer rather than Advance Wars'**
  — points spent *before* the match, not income earned during it — which is the
  far cheaper half: no bases, no capture economy, no production queue, and
  nothing new during play.

  ⚠️ **It is the lever Advance Wars uses on indirect fire and this game does
  not have.** AW prices its 3–5 range weapon at fifteen infantry; here two of
  eight units are that weapon, free, every game. Cost is what makes fielding a
  second gun a decision instead of a default.

  ✅ **The mechanism is not this epic's.** Per-player armies, the deployment
  zone, and the validation that reads them are in *Tuning and gameplay tweaks*,
  because composition is a playstyle question before it is an economy. What is
  left here is the pricing: a cost column beside the catalog, a budget constant
  to tune like any other dial, and one more clause in the validation that epic
  builds.

  ⬜ It also becomes match data, so it lands with the ruleset-versioning
  question rather than before it. The builder itself is UI and belongs with
  *UI and interaction*, and the sweep that prices it needs the simulator to
  take an army first — see *Armies, and where they deploy*, which owns that.

- **Maps into a table, and an editor over it.** Settled in *Maps in a table*
  above. The storage half is a migration and a foreign key; the editor is the
  half that makes it worth doing, and it is the first tool in this repo written
  for an author rather than a player. ⚠️ Almost all of it already exists:
  `parseTerrainGrid` reads the rows, `maps.test.ts` already knows what makes a
  board valid — deployable, crossable, one army each way — and `/maps` already
  draws one. An editor is those three joined by a paint tool.
- ⚠️ **New terrain is worse than nothing until a number reads it.** Terrain has
  exactly two mechanical dimensions — `cost`, which movement reads, and
  `defense`, which `computeDamage` reads — so a type differing only in `defense`
  is invisible in play, and one differing only in `cost` mostly duplicates
  `river`. ⚠️ **And the distinct count is five, not six**: `road` and `bridge`
  are mechanically identical, differing only in the character that draws them
  and the model that renders them. Revolutionary-war terrain is a real want —
  fields, woodlots, orchards, marsh, and stone walls above all — but the first
  three are a **palette** job touching no rule, and a wall is not a tile at all:
  cover *from one direction* is an **edge** feature against a grid that only has
  cells, and it multiplies with facing.
- ⚠️ **Match length, if the answer turns out to be army size.** *Multiplayer*
  wants a match to be one sitting and cannot make the game *end*; *Tuning and
  gameplay tweaks* owns the question. It lands here only if the dial chosen is
  the roster rather than a turn limit or an ending condition.

### 15 — Platforms beyond itch

itch is *A hosted build*'s target and is not repeated here; this is the portals
that gate, review, or supply their own accounts. Worth attempting only once
*Presentation* and *Content* have moved playtime and retention — the one portal publishing a bar publishes a
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
