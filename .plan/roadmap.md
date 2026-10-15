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

### Duplication left on purpose

From the code-health review that gave each rule one home. These looked like
duplication and were left alone, because the copies cannot disagree today or
the fix would cost more than the risk — DRY and KISS together. Revisit one when
its reason stops holding.

- **`band()` dividing by the number of bands**, a band's width only because
  `MAX_HEALTH` is 100. Not silent: `combat.test.ts` pins `band(MAX_HEALTH)` to
  `BANDS`, so changing `MAX_HEALTH` fails the build, and that is when to fix it.
- **An `ATTACK_KINDS` list for the protocol's `'attack' | 'charge'` check.** A list
  beside the union would be a second home rather than one, and a new kind
  already fails loudly, as a 400.
- **The lobby's `winner === null` rather than `isOver`.** It asks *is there a
  winner to name*, not *is it over* — after a draw they would differ — and it
  keeps TypeScript's narrowing of `winner`.
- **The movement budget, looked up by three callers** (`validateMove`, the
  overlay, the bot). A catalog lookup rather than a rule; worth one home only if
  a budget ever comes to depend on state.
- **The attacker after its move, built by hand five times without its new
  facing.** One spread; nothing reads an attacker's facing — only a defender's —
  and `validateMove` already decides what an attack ends facing.
- **Adjacency asked as neighbours in one place and as distance 1 in another.**
  Identical on a square grid by definition.
- **`hitsToKill` applying damage by hand.** It counts unanswered hits on
  purpose, and `health − damage ≤ 0` is the whole of the rule it uses.
- **`health <= 0` in four places.** The plainest statement of one fact; a
  helper would not be simpler.
- **`MAX_ANIMATED_EVENTS` derived from what `resolveAction` emits.** A pacing
  choice, not a rule; a new event type costs at most one snapped animation.
- **The client's `ok: false` meaning both a refusal and a network failure.**
  Client-internal, and the panel shows the reason either way.
- **The menu reading the display copy while the forecast reads the server's.**
  They cannot differ while the selection resets on every submit.
- Unfrozen server constants, duplicated test helpers, and the charge harness
  naming approaches by hand: cosmetic.

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
- **Buildings.** A terrain type — a garrison — carrying the most cover: four stars, with nothing beyond the tile's type stored.
- **Elevation as a rule.** Height stays presentation only: `surfaceAt` lifts a unit onto a mesa and picking finds it there, but no rule reads a height and no tile carries one. Declined for four reasons, in the order they bite. **Terrain already says it** — hills are the best cover on the board and dear to reach, which is "high ground is worth holding and dear to reach" under another name, so a height *defence* bonus would tune one dial twice. **Two original mechanics are still settling** — charge and facing both shipped, and play has since moved three things to get them sitting right; a third interacting axis is the trap this document warns about elsewhere, and it is a worse bet now there is evidence the first two needed the tuning. **The camera caps it** — at 38.6° a surface at height `h` draws `1.25h` tiles up-screen, and a spike showed tile identity collapsing by a full tile, so real relief needs a lower, rotating camera. And **it changes the pace**: "can I get up there" becomes a question on every move, which is Final Fantasy Tactics' game rather than Advance Wars'.

  ⚠️ Two findings worth keeping if it is ever reopened. `entryCost` takes a *destination*; height would make it take a **step**, which is a real signature change but a contained one — `exploreMovement` and `validatePath` are its only callers, and invariant 10 is what guarantees that. And if height ever did enter combat, the door is an **attack** bonus for striking downhill rather than a defence bonus for standing high, because terrain does not express the former and already expresses the latter.
- **Manual routing.** Dragging out a deliberately non-optimal path. Unblocked by the protocol carrying a path and the server validating it — purely a matter of building the UI for it. ⚠️ The substrate now exists and did not before: a route is **pinned, re-pinnable, and drawn as an arrow**, so waypoints have something to hang off rather than needing the whole idea built at once.
- **A blocky / voxel art style.** Tried on a branch with [KayKit's Block Bits](https://kaylousberg.itch.io/block-bits) and rejected — recorded so it is not re-litigated from the screenshots alone. It works: every terrain maps onto a block, and **the autotiler turns out not to be load-bearing** — a cube has no shoreline, so a one-tile river bends through a right angle with no mask arithmetic at all, and `composeTerrain` drops from ~250 lines to ~60. What killed it is the camera. The style lives on block *sides*, a near-top-down board shows only tops, and stepping by whole blocks to expose the sides is the elevation problem above. So it is a real option, but only alongside a different camera — not a swap.

## The epics

**Order is in the table at the top of this file**, not here. Each section below
is self-contained; read the one you are about to work on.

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

⚠️ **It runs in passes: play, then tune.** Five have shipped. The first set
terrain weighting and the first charge numbers by printing grids; the second,
the combat pass, came from playing — see *After the combat pass*; the third
reworked charging — see *The charging pass*; the fourth added a general — see
*The general's pass*; the fifth moved cover to Advance Wars' scale and paced
the charge per unit — see *The cover pass*. A pass's changes go to
[`architecture.md`](architecture.md) and leave only their open questions here.

⬜ **The next pass is planned** — see *The next pass*, below.

#### Known to want attention

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
  overwatch and engagement turned out to be one question. The same sweep also
  says a cautious bot would show less first-mover advantage than a greedy one
  does, which is itself a hint that punishing the advance is aimed at the right
  thing.

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

✅ **Whether composition creates playstyles: swept, and it does not — it
makes a ladder.** Each army against the default, on every map from both seats
and both openings: more guns wins and more horse loses, on every map, and that
order has survived sword cavalry, the earned charge, the general and the cover
pass. ⚠️ **It says as much about the bot as the armies**: a greedy bot never
screens, and screening is the manoeuvre horse needs, so the horse figures are
a floor. ⚠️ **`common` says nothing about composition**: the opener wins there
whatever it fields — see the turn-order note under *After the combat pass*.

#### The next pass

⬜ **Planned and pre-checked, from playing.** Fourteen commits, in this order:
the default army as it is being played; losing the army as well as the
general; the spent grey a little more saturated; a new terrain failing to
compile until it is drawn; sea; structure; a map's size beside its name; each
map declaring where its armies deploy; a frame around every board; and four
boards from Advance Wars at their own sizes, a commit each, drawn with sea and
structures.
Each passes the gate — `tsc -b --force` included — and lands with its docs.
Comments, docs and test titles that quote a value, or anything else a change
can move, are removed rather than updated.

⬜ **The default army as it is being played** — `cagac.....` over `iiiii.....`,
ten a side at the left of the zone, already in the working tree from
playtesting. Nothing breaks: the suites pass with it, since every positional
test supplies its own army. What it touches is prose:

- The opening summary of the architecture doc and the README name the army's
  make-up and count, and stop doing so — they describe a default army of a
  general with guns, horse and foot.
- `ARMY`'s comment describes the layout and counts its rewrites; both go.
- The roadmap's note under *After the combat pass* that centring the army
  flipped the opener's edge describes a centred default that is no longer the
  default, and is cut to the finding.

⬜ **Losing your army loses the match, as losing your general does.**
**Decided**: a player left with nothing but its general has lost. It settles
*two lone generals never finish*, under *The general's pass*, which goes.

- **One clause in `victor`**: a player stands while it has a unit besides its
  general and its general has not fallen. An `isGeneral(unit)` query beside
  `generalOf`, which `generalOf` then reads, keeps the type named once. A
  board without a general plays as now.
- **Still one loss per resolution**: a battle kills one unit. ⚠️ An army of a
  general alone loses on the first resolution; armies are not validated, so
  that is accepted as a degenerate army.
- **The bot asks the rules whether a kill wins**: a kill scores the win bonus
  when `victor` of the board without the target is the bot's own side,
  replacing its bonus for a general and its own `isGeneral`. `victor`,
  `generalOf` and `isGeneral` are exported from `shared` for it. ⚠️ *Won by
  general* read "the loser still had units", which a loser down to its general
  now passes; it compares the loser's general at the start and the end,
  which also leaves an army that fielded none uncounted.
- **Tests** — two change, found by running the suites with the rule in:
  `victory.test`'s *is nobody while both generals stand, whatever else falls*
  and `action.test`'s *does not heal a unit the turn's last action killed*,
  each by giving the side a second soldier. New: in `victory.test`, a player
  left with only its general has lost, and either loss alone is enough; in
  `action.test`, killing the last soldier beside a standing general ends the
  match.
- **Comments and docs**: `victor`'s doc; `action.ts`'s note on the fold, which
  also loses its count of units; *Victory*, the opening summary and the README.
  The simulator's unfinished matches are read before and after.

⬜ **The spent grey, a little more saturated.** `SPENT_GREY` comes down a step;
checked in a browser beside the current look.

⬜ **A map's size beside its name**, in the start screen's picker and the map
viewer's.

- `MapSummary` gains `width` and `height` — the names the board's own code
  uses — worked out from the rows where the list is served, destructured so
  nothing else leaks; the comment that rows are nobody else's business stays
  true, since only their count leaves.
- One helper, `mapLabel` in `client/src/routes`, labels a map for both
  pickers: the name, then the size, width first, after the lobby's own " · ".
- **Tests**: `http.test`'s list case checks every map has a size, and a new
  black-box case checks each listed size against the grid its preview draws,
  so the two cannot disagree. `StartScreen.test`'s fixtures gain sizes — one
  not square, so the order shows — and a new case finds a labelled option.
  `MapViewer.test`'s fixtures take the sizes of the boards its fake preview
  draws, and its two option assertions follow the label.
- **Docs**: the protocol's `MapSummary`, and the two routes.

⬜ **A map declares where its armies deploy.** **Decided**: the zone stays ten
wide and two deep against the board's edge — near for the first seat, far for
the second — and a map says where along that edge each sits. A map that says
nothing is centred, as every board is today.

- **`GameMap.zoneStarts?: [near, far]`**: the board column of each seat's
  westmost zone square, in board coordinates whichever way the seat faces. A
  labelled tuple indexed by seat, as the placement code already is, so a
  partial declaration cannot be written.
- **Placement**: with `slack` the board's width less the zone's, the default
  is `[floor(slack/2), slack - floor(slack/2)]` — the far one the near one
  turned, which on a board with an odd spare column sits one column east, and a
  naive `[m, m]` would quietly move. The near army is placed from its zone's
  start; the far one is turned within its own zone, drawn from its own left.
  Checked against today's `createMatchState` for every width and zone up to
  twenty-five: the default reproduces it exactly.
- **Refused, not clamped**: a declared start that is not a whole number or
  leaves the zone off the board. The two zones cannot overlap — the existing
  depth check already puts them on different rows.
- `DEPLOYMENT_ZONE` keeps the size and every caller keeps its signature;
  `createMatchState` reads the starts from the map. The preview, the store and
  the simulator take declared zones through it with no change.
- **Tests**: every existing `matchState.test` case stays, its boards declaring
  nothing. New: a declared zone places each army where the map says, the far
  one still from its own left, at columns that tell declared, centred and
  turned-from-near apart; an undeclared zone on an odd-width board is centred
  with the far one a column east; a declared zone off the board is refused,
  naming the seat. `maps.test` validates declared zones through
  `createMatchState`, so a zone over water or rock fails it unchanged.
- **Comments and docs**: `DeploymentZone`'s and `DEPLOYMENT_ZONE`'s say size
  only, place being the map's; the far army's comment says it is turned within
  its own zone; the warning about water and rock under the zone moves from
  `ARMY` to the new field; `maps.test`'s and `matchState.test`'s headers lose
  their stale lines. The architecture doc's *Maps* passages on the centred zone,
  its margin, its rotation and the middle ten columns.

⬜ **A new terrain fails to compile until it is drawn.** Today it compiles and
draws as plains: `composeTerrain`'s `baseCell` ends in a `default` that
returns grass, and no client table is keyed by `TileType`, so the comment in
`terrain.ts` promising "the renderer's colours" become a compile error is
stale. The `default` becomes `case 'plains'` with the `never` check
`applyEvents` uses, and the comment is reworded. Its own commit, ahead of the
two types below, which it then forces through the renderer.

⬜ **Sea**: water nobody can enter yet, so Advance Wars' island maps — a third
to a half sea — can be drawn closer to their originals.

- **Rules**: `w`, cost `null` for every movement type, defense 0, which is
  never read since nobody stands there. Nothing else is needed: `entryCost`
  refuses it, a charge cannot ride onto it, deployment zones cannot hold it,
  and fire crosses it, as in Advance Wars.
- **Models**: there is no sea or coast model in the shipped subset of the
  Kenney nature kit, nor any Kenney pack on this machine — but the river
  pieces already tile a body of water by its neighbours, so sea **is** that
  body. `isWater` counts sea with river and bridge, so a river mouth opens into
  the sea with no bank across it, and the board's edge counts as water as it
  does today.
- ⚠️ **It must not look like river**, which foot and horse wade. A sea cell
  carries a paint the river does not, read where the models are coloured, so
  its water takes a deep teal-navy of its own — one more draw call. Not the
  blue army's colour, or blue pieces vanish against it. The banks stay as they
  are, which reads as a beach. The close-up builds its ground the same way, so
  it gets the paint for free.
- ⚠️ **A bridge over sea** draws river-coloured water under its deck, since a
  bridge takes no paint; it is painted from its water neighbours.
- **`maps.test`'s crossability threshold** — wheels reaching more than half the
  board — fails by construction on a board more than half sea; it is measured
  against land, the tiles some movement type can enter. Its comment that the
  check only has teeth for wheels stops being true: sea strands every arm.
- ⚠️ **The bot will stall at a coast**: it approaches by distance as the crow
  flies, so it parks at the nearest shore. Its approach reads the movement
  search's own path length instead, before any sea board's numbers are read —
  and `lakeland`'s unfinished matches may be the same thing already.
- **Tests**: in `movement.test`, sea refused to every movement type and a strait
  not crossed; in `composeTerrain.test`, sea joining river with no bank, sea
  cells painted and river cells not, and sea running off the board. Existing
  sweeps over `TERRAIN` cover it unchanged. `maps.test`'s threshold, and a
  sea-heavy fixture passing it while an unreachable island fails.

⬜ **Structure**: a generic building, a grey box on its tile for now, giving
four stars of cover.

- **Rules**: `#`, defense 4, and **1 to enter for every movement type**, as
  Advance Wars charges for a city — **decided**, knowing it makes the first
  four-star ground a gun can hold. Four stars passes the *no living attacker
  is harmless* sweep; the floor comes at seven. Whether one may sit in a
  deployment zone is left to how maps are drawn, not made a rule.
- **Model**: a box built in code and registered beside the kit's models, so it
  is measured, merged, instantiated and staged in the close-up like any of
  them, and real art later is a change of one name. A unit stands on top, as on
  a mesa: about four fifths of a tile across, so neighbouring buildings stay
  apart, and low enough that its top sits under the stand-height ceiling and
  below a mesa's. No scenery is scattered on it. Its grey differs clearly from
  road gravel and mesa stone; a browser decides.
- **Tests**: in `composeTerrain.test`, a structure is grass with one centred
  prop a unit stands on and nothing scattered; the existing prop fixtures gain
  one. In `combat.test`, a defender on a structure takes less than one on
  hills, as an ordering rather than a value.
- **Docs, for both**: `terrain.ts`'s comments — hills stop being the best cover;
  the architecture doc's terrain, zone, water, prop and recolour passages; and
  the roadmap's *New terrain is worse than nothing until a number reads it*,
  which both pass, and its count of distinct terrains.
- **DRY**: `charges.ts` lists its grounds by hand, so a structure would be
  silently missing — it reads them off `TERRAIN`, as `matchups.ts` does. The
  legend comment copied into all seven maps contradicts `terrain.ts`'s "the
  legend lives here and nowhere else", and goes.

⬜ **A frame around every board**, four tiles wide, continuing the board's edges
outward so the board reads as a piece of a larger land. No grid lines, no
hover or click, no overlays; the camera frames and pans on the board alone.

- **Built from what exists**: one pure function extends the grid by four on
  every side, each frame tile taking the nearest edge tile and each corner
  block the corner tile, and the extended grid is composed and drawn whole, so
  rivers and roads autotile across the seam. The board's own cells are sliced
  back out for everything that asks about the board — standing heights,
  picking levels, the close-up. It never enters `GameState`, so no rule, the
  server or a unit can reach it. Picking already ignores an off-board tile, so
  the frame takes no clicks with no change to picking.
- **What copies and what does not**: a road continues only where it crosses
  the edge, or a road along the edge would widen into a plaza; a bridge
  continues as road where its road leaves the board — a causeway — and as river
  where its river does; a structure becomes plains rather than a wall of boxes;
  sea, river, forest and hills copy. A table keyed by `TileType` holds this, so
  a new terrain has to say. **Roads run off the rim** — decided — rather than
  ending in a cap at the frame's outer edge, which flips roads' off-grid rule
  and changes three of `composeTerrain.test`'s cases.
- ⚠️ **The camera keeps the board's rectangle** for its fit — today it measures
  the slab's bounding box, which would swallow the frame — and its radius
  grows to the framed board's, or at the shallow tilt turned 45° the frame's
  near corner falls behind the near plane on a 12×12.
- **Measured**: about twice the instantiations on today's boards, the same
  draw calls — the frame uses only models the board already has — and a
  forest-heavy edge as the worst case for build time, which the browser check
  of canvas-ready time covers.
- **Tests**: in `composeTerrain.test`, the board unchanged inside its frame;
  edges and corners continuing; a road crossing the edge running to the rim
  and its edge tile composing as a straight; a road along the edge not
  widening; a bridge continuing as road or river; a river keeping its channel;
  sea continuing and a structure not. Picking is checked in a browser, as are
  the seams at all four edges, framing at two window sizes, the shallow tilt
  turned 45° on the tester, and the map viewer.
- **Docs**: the architecture doc's camera, slab, grid lines and woods bullets,
  and a new one for the frame.
- **Decided**: the scenery reshuffles once, every seed shifting by four, rather
  than keying seeds on board coordinates; frame trees in front of the near row
  are accepted and looked at in a browser; and picking stops falling back to
  an edge tile for a pointer just past the far edge, which the frame would make
  visible — one line.
- **Decided: a hard outer edge**, the slab grown to sit under the frame as well
  as the board — a diorama, its earth sides showing — since at the default zoom
  four tiles still leave the backdrop showing beyond them. A fade into the
  backdrop, a small shader on the terrain materials, was the alternative and is
  not built.

⬜ **Four boards from Advance Wars, at their own sizes.** **Decided**: maps
come in different sizes rather than one standard; the small ones stay as
skirmishes; four new boards, each drawn from a known Advance Wars map at that
map's own size, two of them rotated 180° and two not; and how many units a
side a board holds is **not codified** — the new boards take the default
army, and play says what that is like.

- ⚠️ **Large boards have been tried once.** The boards were all 20×20 for
  seventeen minutes in September, and came back to 12×12 as too empty —
  Advance Wars fills that space with properties and production, and this game
  has neither. That was before combat existed, and the commit said the size
  was settled only until it did; it named army size as the dial if a board
  plays empty. So the risk is known: the default army on these boards is far
  sparser than Advance Wars' pre-deployed density, and play is what decides
  it. ⚠️ **Duo Falls is 33×13**, its armies at the narrow ends. Zones sit only
  on the near and far edges, so it is drawn turned a quarter, 13 wide and 33
  deep — the ten-wide zone fits its narrow ends.
- **Sources for the four**, each named in its board's comment:
  - rotated 180° — **Twin Isle**: each half a ridge of hills ringed by road,
    the halves joined by one neck across a river band, the only crossing for
    wheels. **Duo Falls**: two rivers across the board, each with its crossing
    at the opposite flank, so the road zigzags and guns go the long way while
    foot and horse ford.
  - not rotated — **The Trident**: three lanes split by water or hills on one
    side, funnelling into a single road through broken ground on the other.
    **Missile Plains**, already exactly 20×20: three ridges of hills across the
    board, each with one gap, staggered, so wheels zigzag and foot climbs.
  - Sea is drawn as sea, structures stand in for cities and bases, and hills
    for mountains; pipes and silo walls become ridges of hills. Shoals and
    reefs become river where they are fordable in spirit. **Decided: each at
    its original's size** — Twin Isle 22×16, Duo Falls 33×13, The Trident
    19×19, Missile Plains 20×20 — since sizes are free.
- **What a board must pass**: both zones standable by every movement type, so
  no river, sea or hills under them; wheels able to cross between the zones
  and to reach more than half the land; and
  the written conventions — zones on plains or road, roads one tile wide, a
  road into each zone, broken ground in the middle. Off-centre zones use the
  declared field.
- **Each is simulated** from both openers. ⚠️ On scratch 20×20 boards the second
  mover won from both openers, the reverse of the 12×12s, so both openers are
  not optional; and guns take several turns to reach a firing position, so
  their share of damage is read per board. The action cap stays: decisive games
  on scratch 20×20 boards ended well inside it once the army rule was in, and
  what hits it is a stalemate no cap fixes. Its comment, which quotes the
  roster, goes.
- **The renderer needs no change to work** — the camera, picking, grid lines
  and terrain all scale with the board, and draw calls follow the palette and
  the army rather than the area. At the default zoom a 20×20 draws tiles at
  about three fifths of a 12×12's, so a browser checks, on one board:
  framing at fit at two window sizes; whether the health rings, the grey and
  the charge digits read at that size, and whether the counter needs enlarging;
  whether the maximum zoom gets close enough, or should scale with the board;
  frame rate and draw calls while orbiting, and canvas-ready time on the most
  wooded board; picking at the far corners and on hills and decks; and the map
  viewer's framing.
- **Optional guard**: the registry builds a lookup with `Object.fromEntries`,
  which drops a duplicate id silently; with four new files, `maps.test` asserts
  ids are unique.
- **Docs**: the architecture doc's map sizes — it records 12×12 as settled with
  both ends of the old overshoot, which becomes the skirmish size beside the
  new one — and its table of boards gains four rows.
- **Reference, from research into Advance Wars**: its single-screen missions
  are 15×10 to 16×12, its battles about 16×16 to 21×21, and the competitive
  pool's median about 21×21; its pre-deployed missions hold about a unit to
  every nine tiles; every competitive map is a 180° rotation, though the
  official War Room maps mostly are not; composition runs about half open,
  forest sparing, rivers and high ground shaping two or three lanes, heavy
  cover off the front; and player two is usually given about half a turn's
  worth. Sources: the Advance Wars By Web map pool and API
  (awbw.amarriner.com, including Twin Isle, Duo Falls, The Trident and Missile
  Plains), the AWBW mapmaking guide (github.com/TheGamerASD/AWBW-Mapmaking-Guide),
  Wars Wiki (warswiki.org), and the Wargroove wiki on first-turn advantage.

#### The cover pass

✅ **Shipped**, from playing: cover on Advance Wars' scale, with the mountain
renamed hills; each unit type filling its charge meter at its own pace;
inspecting a unit that cannot act; and the units that have acted greyed. With
them came a dev handle for addressing tiles in a browser check, and the
simulator's charges by type and attacks by ground. What it does is in
[`architecture.md`](architecture.md); what was measured was reported in
conversation rather than written down.

⚠️ **Highlighting the ready units, instead of greying the spent ones, was tried
and set aside.** A Fresnel rim lit whole flat-shaded facets, washing a unit out
or reading only as paler; Babylon's mesh outline broke into shards, each flat
face pushed along its own normal; a screen-space outline was clean but a line
was too much; a glow layer was not it either. Each costs a pass or more every
frame, where a material swap costs none.

#### The general's pass

✅ **Shipped**, from playing: a general on each side, the action panel opening
where a unit stands with a Move row while it has not walked, and the board's
panes kept on the board. What it does is in [`architecture.md`](architecture.md);
the general's open questions are below.

✅ **The general.** From playing: battles ended as gun duels — the other arms
fought it out under bombardment, and the guns were what was left. A general
gives every match something to defend and something to hunt, and plays like
the king in chess: kept back and protected, with the wounded falling back to it
to heal. It is cavalry in all but name for now, and exposed to guns on purpose,
so keeping it out of their reach is the game. What it does is in
[`architecture.md`](architecture.md).

- ⬜ **Two lone generals never finish.** In the simulator, matches the bot
  leaves unfinished went from none to a fifth on `classic` and `crossroads`, 100
  games each, and nearly all of them end with one general a side and nothing
  else: the bot keeps its general away and attacks only where it kills, so once
  the armies are gone neither general closes. Partly the bot, but not only — a
  general is as fast as anything that could chase it. Undecided: a rule that
  settles it, such as a general with no army having lost, or a bot that fights
  with its general once it stands alone. ⚠️ **The rule is the favoured one,
  pending play**, and it fits: elimination becomes "no units besides the
  general", one clause in `victor`, and boards without a general play as now.
  The bot would then want to ask `victor` whether a kill wins, rather than keep
  its own copy of what winning is.
- ⬜ **For play to answer**: whether the heal pulls the wounded back. The bot
  never retreats a unit to heal, so it healed 20 points in 100 games, and its
  generals fell in about 1% of decided matches.
- ⬜ **Later, global bonuses**, as Advance Wars' commanders give. Both sides
  field the same general for now; a commander chosen per player can carry
  modifiers later without the unit changing.

#### The charging pass

✅ **Shipped**, from playtesting notes. Charging felt off, and the simulator said
why: a charge was the *wounded* unit's attack, a healthy unit's charge was a
worse shot, and infantry made half of all charges. So cavalry fights with
sabres, as a `melee` unit that cannot answer a ranged attacker, and the charge
is earned: attacks fill a meter, and a full meter buys a charge that is
certain wherever an attack's best roll, times the side it arrives on, would kill
— and a gamble above that, its odds falling to a quarter against a fresh unit,
scaled by the side and by the charger's own health. A failed charge is met by a
free attack from the defender. A first cut scaled a separate threshold table by
cover and the charger's health; it never finished anything an attack would not,
even from the rear, so the line became the attack formula, and offering only
certain charges then gave way to odds above it. Earlier in the pass the attack
forecast's counter and the simulator's dice, exchange and distance each got one
home. What it does is in [`architecture.md`](architecture.md); why, and what was
measured, is in the commits.

⬜ **For play to answer:**

- **The side multipliers are first numbers** — 1× head-on, 1.25× flank, 1.5×
  rear — and so are each type's meter size and the 25% a fresh charger has
  against a fresh unit head-on. Head-on at 1× was chosen, so a head-on charge
  is sure of what an attack's best roll might kill. `scripts/charges.ts` prints
  each charge's line beside the attack's, and its odds against full health.
- **The cliff just over a wounded charger's line** — certain of one target and
  a long shot against one a few points healthier — is the price of scaling the
  whole curve by the charger's health, and was accepted.
- **A rear charge can be certain of a full-health unit** where there is no
  cover. Accepted rather than tuned away; the rear multiplier is the dial if it
  reads as too much in play.
- **The simulator's bot weighs a charge's kill by its odds** against the free
  attack it risks, so it charges at odds when nothing else scores better. What
  it does with the odds says little about what a player would.
- ⬜ Later: **dragoons**, horse with carbines — the `melee` flag is what makes
  room for them, and their model is already in `public/models/`.

#### After the combat pass

✅ **The pass shipped**: contact, a flanked defender answering in full,
artillery's row, and luck scaled in with its rolls recorded; its charge
half-life went with the charging pass. What it does is in
[`architecture.md`](architecture.md); why, and what it measured, is in the
commits that landed it. What is left is for play to answer.

⚠️ **One shot in eight is answered, and what makes a shot free is the range
design rather than a rule.** A shot goes unanswered because it killed (35%),
because the target cannot reach back — a gun at three to five, or infantry at two
against cavalry (33%) — or because the target is a gun (17%); from the rear is
3%. The greedy bot takes a free shot whenever one is on offer, so this is what
the rules *offer*. If play still says attacks are too cheap, the levers are the
ranges and `slow`, not facing.

⚠️ **Contact looks like it rewards moving second.** On `common` the second mover
wins from both openings — 63% when blue opens, 67% when red does — where before
contact it was near even, and `classic` turned the same way (53% and 62%).
`two-bridges` always rewarded replying; `crossroads` is still even. The likely
reason is the rule doing what it says: whoever advances into contact first is
pinned and answered first. The bot always advances, which a human need not, so
this is a thing to watch in play rather than a verdict. Sword cavalry widens
it, from about 55% to 64% across every map. ✅ **Accepted for now**:
the first mover still gets its volley off before contact is made, and tuning
options wait on how it plays.

⚠️ **Centring the default army in its zone flips it, and makes it far
stronger.** Default against default, 200 games each way: the opener wins 94–97%
on `classic` and every game on `common`, and 81% / 57% on `meadow`, while on
`tester` the *second* mover wins 88–99%; `crossroads` stays even. With the army
at the zone's left edge, as before, the second mover won 57–75% on those same
boards. Centred, the two armies start directly across from each other rather
than offset, so whoever strikes first lands on a full line. A thing to watch in
play before the army's placement is settled.

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

⚠️ **The sharp edge is randomness, not the rule.** `rollLuck` draws the same
rolls for every command and never consults the rules, deliberately — so the
number of draws cannot depend on whether a path crossed a watched tile. The
existing precedent is to draw for the worst case: a counter roll and a charge
roll are already drawn whether or not either is used. It also needs watching
state on `Unit`, which is a `GameState` shape change and abandons stored matches
under the ruleset compromise.

⚠️ **The reactive family is unmeasured, and structurally so.** A zone is worked
out from positions alone, so a scratch search can say what it does; a reaction
depends on what the other side chose to watch, which nothing can sweep without
building it.

#### The dials

The tables are `BASE_DAMAGE`, which charges read too, and `CHARGE_FACING`; the
scalars beside them are `LUCK_MAX` and `CHARGE_CHANCE_AT_FULL`, and the
catalog's `attacksToCharge` sets each type's meter. The `defense`
column of `terrain.ts` is a dial too,
and turned out to be the one carrying the most weight.

**Tune against the harnesses, never against a damage number.**
`scripts/matchups.ts` prints hits-to-kill across every matchup and terrain,
`charges.ts` prints what each charge is certain of from all three sides beside
what an attack kills, with its odds against full health, and
`server/scripts/simulate.ts` plays the game against itself and reports outcomes,
match length, damage and kills by unit type, and whether each mechanic fired. ⚠️
**All three have earned themselves** — one killed a table where everything died
in two hits, another found cavalry-into-artillery saturating at the flank on its
opening run, the hits-to-kill grid showed that a wood was worth literally
nothing, and the simulator settled the turn budget in an afternoon.

⚠️ **Read the simulator's mechanic counts before its win rates.** A bot
confirms whatever it is scored on: the greedy one subtracts the expected
riposte from its own score, so it reports counters landing in a tenth of
exchanges, which is the bot avoiding them rather than a fact about counters.
⚠️ **It cannot say whether cover is well placed**, and will not until a bot
values ground: it never *chooses* terrain, so what it reports is where fights
happened to land rather than what either side thought ground was worth.
⚠️ **What it will say is whether cover is anywhere near the fighting**, and that
turned out to be worth having — moving the boards' broken ground off the
deployment edges and into the contested middle took the attacks landing on it
from almost none to a real share, with no change to the bot at all. It counts
attacks by the defender's ground, so a board nobody fights over shows as one;
it is a geometry check, not a verdict on the terrain.
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
- **A roster of cards per player**, one card a unit, marking which can still
  act. It is the fuller form of the greyed units, which stand in until then, and the place for a charge counter that reads the same
  on every unit type. *Multiplayer*'s "*your* units that can still act" is the
  half that depends on who is looking, so the two are designed together.

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

#### 11b — Animation and sound

- **Model animation in the cutaway**, which the cutaway was built to branch on
  and does not. It wants a set of animated figures — a sabre cut that reads as
  one, a volley that reads as one — and until then the close-up stages the
  units still.
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
result below, which came back green. ⚠️ Frictionless to first move is the
requirement, and it is worth stating as one: on a portal, a sign-in wall in
front of a free game is the funnel.

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

⚠️ **Every opponent action clears an inspection.** An inspected unit is a
snapshot that a board update discards, which in hot-seat only the inspecting
player's own actions cause; with two clients, the opponent's moves do too, so
a player studying an enemy's range mid-turn may lose it. Worth watching once
two clients share a match.

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
`victor` already generalises victory to any number of players and
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
metrics a portal actually gates on. *Tuning and gameplay tweaks* is where the
numbers and the argument live; this is the phase that keeps changing them.

- **More unit types.** The catalog is built for this: `Record<UnitTypeId, …>`
  means adding one is a compile error in every table that needs an entry, and
  `maps.test.ts` already checks a new movement type can cross every board. The
  unit catalog's flags are required too, so a new unit has to say whether it is
  slow, fights hand to hand and charges.
- **Whatever play says next.** Three things have already moved this way, and two
  of the three turned out to be rules rather than dials.
- ⬜ **The boards still lean, and the gun's mobility moves them more than they
  do.** Running `simulate.ts` with the same policy on both sides — so any
  departure from even is the board — and playing every map from both openings,
  300 games a cell:

  | map | blue opens | red opens | reads as |
  |---|---|---|---|
  | `crossroads` | 54% red | 53% red | near even |
  | `meadow` | 63% blue | 65% blue | a blue board |
  | `lakeland` | 47% red | 63% red | a red board, 12–16% unresolved |
  | `classic` | 53% red | 62% blue | whoever moves **second** |
  | `common` | 63% red | 67% blue | whoever moves **second** |
  | `two-bridges` | 61% red | 74% blue | whoever moves **second** |

  ⚠️ **Read the pair, not either column.** A fair board gives the opener the same
  edge from both ends; one colour winning *both* columns is the board talking.
  By that test `crossroads` is sound, `meadow` and `lakeland` are biased, and the
  other three are order-sensitive rather than biased — they reward replying,
  from either side. `two-bridges` always did, a property of its chokepoints;
  `classic` and `common` joined it with contact — see *After the combat pass*.

  ⚠️ **`lakeland` does not finish a sixth of its games**, which is worth more
  attention than its bias: a board that cannot resolve is a worse failure than
  one that favours a colour, and the lake is the obvious suspect. The combat pass
  left the count exactly where it was, 49 of 300 when blue opens, so it is the
  board's. **Not pursued**: the maps are due a redesign regardless.

  ⚠️ **Artillery's `movementRange` was the biggest single lever on all of
  this**, and it is measured rather than argued. At **4** the same six boards
  handed the game to whoever moved *second* — 94% on `crossroads` and `meadow`,
  89% on `two-bridges`, a spread of 54% to 95%. At **3**, before contact, the
  spread was 50% to 73% and the second-mover effect survived only on
  `two-bridges`. `wheels` pays 1.5 for plains against 1 for road, so the gun's
  budget decides how much board it covers between replies, and a road network
  amplifies whatever that number is. ⚠️ **So settle the gun before redrawing a
  board to chase a number** — the terrain is downstream of it.

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

  ✅ **The mechanism is built**: per-player armies and the deployment zone, and
  a simulator that takes an army a side, which is what pricing needs. What is
  left is a cost column beside the catalog, a budget constant to tune like any
  other dial, an army builder — UI, so *UI and interaction*'s — and validation
  that answers rather than throws: `createMatchState` and `parseArmyGrid` throw
  on a bad army, right for a server constant and a 500 for a client-supplied
  one.

  ⬜ It also becomes match data, so it lands with the ruleset-versioning
  question rather than before it.

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

### 15 — Platforms beyond itch

itch is *A hosted build*'s target and is not repeated here; this is the portals
that gate, review, or supply their own accounts. Worth attempting only once
*Presentation* and *Content* have moved playtime and retention — the one portal
publishing a bar publishes a specific one, and the game is judged against it
rather than against a portal-wide average.

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
