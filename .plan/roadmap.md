# Victory or Death — Roadmap and design

Forward-looking only: mechanics that are specified but not built, and the
order they are planned in. What the code does *today* is in
[`architecture.md`](architecture.md); nothing here describes current
behaviour.

---

## Combat ⬜

Modelled on Advance Wars' actual mechanics. What follows is the reference behaviour with sources, then where we intend to diverge — kept together because the divergences only make sense against what they're diverging from.

### The damage formula

Stripping CO modifiers (which we don't have), AW reduces to this — ⚠️ **written in AW's units, where HP is the displayed 1–10 and not our 0–100. Do not implement this line:**

```
damage = baseDamage × (attackerHP / 10) × ((100 − terrainStars × 10 × defenderHP / 10) / 100)
```

**Ours** — the only version to build from:

```
band(hp) = ceil(hp / 10)                      // 1..10, never 0 while alive
damage   = floor(floor(baseDamage × band(attackerHP) / 10)
                 × (100 − terrainStars × band(defenderHP)) / 100)
           + luck                              // last, flat, unscaled
```

⚠️ **Both HP terms read the ten-point band, not the raw value — and this is load-bearing, not a rounding preference.** AW's formula reads *displayed* HP, which is `ceil(internal / 10)`, so a unit on 1 internal point still attacks at 1/10 strength. We store and display 0–100 (see the next section) but the formula still reads the band, because feeding it raw health makes a living unit attack at 1% and the floors swallow it: **measured, cavalry at 4 health or less dealt zero to infantry in forest even on a maximum roll.** Two wounded units could then be permanently unable to kill each other, and elimination is the only way a match ends.

⚠️ **AW has no minimum-damage rule and needs none** — the banding *is* the mechanism. Zero stays reachable at the extremes, which is faithful; it is just no longer a predictable band. A `Math.max(1, …)` clamp was the alternative and was rejected: it invents a rule to paper over dropping one AW already had.

⚠️ **One rule, both sides.** Applying the band to the attacker alone would be half of AW's formula with no principle choosing which half. The cost is real and is accepted: a unit at 91 health and one at 100 fight identically while the bar shows two different numbers — AW's arithmetic without AW's rounded display to hide it.

Taking the AW line literally is a separate trap and not a rounding difference either: at 4 stars with a full-health defender, `100 − 4 × 10 × 10 = −300`, so mountains would *heal* the unit standing on them. `baseDamage` stays a percentage of a full-health target, exactly as AW's tables give it, so the matchup numbers transfer unchanged.

Every step rounds down. Three things fall out of it:

- **A wounded attacker hits softer** — by ten-point band, not smoothly. Four of them can share a step, and the bar will show four different numbers while they fight identically.
- **A wounded defender loses its cover.** Terrain defence scales by *defender* HP, so a 4-star mountain protects a full-health unit far more than a nearly-dead one. This accelerates kills and stops damaged units turtling on good ground.
- **Terrain is not a minor modifier.** Four stars at full health is a 40% reduction. Tuning a matchup table with defence stubbed to zero would produce numbers to throw away — which is why terrain comes first.

**Luck** adds 0 to +9, and needs **no rescaling** — the 0–9 is already in our units, because `baseDamage` is a percentage in both schemes.

⚠️ **It is added last, flat, and scaled by nothing.** This doc twice said the opposite — that luck folds into the base before the health multiplier and therefore narrows as an attacker weakens. A [ROM-derived reconstruction](https://github.com/geno55/advance-wars-advisor) of the GBA engine finds luck applied *after* every multiplication and truncation, as a plain addition of true hitpoints. Wikis describing luck as scaling with HP disagree with the ROM, and the ROM wins.

⚠️ **The difference is not cosmetic, and it points the other way from the old claim.** Folded in, a weak attacker's luck shrinks with it. Added last, **luck is worth proportionally more the weaker the attacker is** — at the current table a full-strength volley of 27 carries the same ±9 as a crippled one of 18, which is half again as much of it. A nearly-dead unit's best roll is most of its remaining threat, and damaged units are *swingier*, not steadier.

#### ⚠️ Flat luck, measured — and why the alternative was refused

Both formulas were built and compared cell by cell before keeping this one. **At full health they are indistinguishable** — one point apart, from rounding — so nothing about a healthy exchange turns on the choice. Hits-to-kill barely moves either: 6/4 against infantry with cavalry under both.

They differ entirely at the bottom of the health scale:

| cavalry → infantry, plains | full health | band 1 |
|---|---|---|
| flat (kept) | 18–27 | **1–10** |
| folded in | 18–26 | **1–1** |

⚠️ **Folding does not narrow luck at low health, it annihilates it.** `floor((20 + 9) × 1/10)` and `floor(20 × 1/10)` are both 2 — the integer divide swallows the whole roll. **There is no version where luck narrows but stays meaningful**: the two options are a full lottery and nothing at all, and the middle does not exist.

**What luck buys, and its price.** The governing ratio is `LUCK_MAX ÷ (base/10)`, so a roll is worth 1.2 bands of health against artillery's 75 and 4.5 against cavalry's 20. Measured as *how many bands of health advantage a good roll overturns*:

| | overturn, flat | folded |
|---|---|---|
| artillery → infantry (75) | 1 | 1 |
| infantry → infantry (30) | 3 | 2 |
| cavalry → infantry (20) | **5** | 3 |

A cavalry unit at 10 health rolling well matches one at 60 health rolling badly. ⚠️ **Note this was made worse by widening the damage table** — the old floor of 40 put luck at 2.25 bands, the new floor of 20 puts it at 4.5. Spreading damage narrowed reliability.

**Kept anyway, because the texture is worth it.** Reliability becomes a unit trait nobody designed: artillery is precise, infantry moderate, cavalry a lottery. Carbines from horseback being erratic is right, and it gives three units a second axis of difference beyond raw damage. ⚠️ A crippled unit can never match a *full-health* one in any matchup — band 1 at its best is 10 against a full-health worst of 18 — so the swing is between neighbours on the scale, not a reversal of it.

⚠️ **If five bands ever proves too much, the lever is `LUCK_MAX`, not the ordering.** Lowering it turns overturn down everywhere at once and keeps the reliability texture; folding the roll back in only moves the bottom of the scale, and moves it to zero.

### HP representation — where we diverge ⚠️

**AW stores 100 internally and displays 1–10.** A displayed "9" is anywhere from 81 to 90. Three consequences people know the game by:

- You cannot read exact health off the board.
- **Counter-attacks reliably under-deliver** versus the preview, because the defender counters on its real internal HP while the preview used the rounded display.
- Chip damage accumulates invisibly until a bar drops.

**We keep 100 internal and display 100.** The 1–10 display was a GBA screen constraint, and inheriting it means permanently explaining why a "9 HP" unit died to 15 damage. The counter-attack surprise is arguably good texture, but it should be a choice rather than an inherited artefact.

This is upstream of the formula, the preview, the health bar, and the tuning harness — which is why it's settled here rather than discovered later.

### Terrain defence

Each star is 10% reduction *at full defender HP*. **The values live in the terrain table (`architecture.md`) and this section does not restate them**, because it used to and drifted: the old table here was AW's, listing `Woods` (our `forest`), plus `City` and `HQ`, which are buildings the roadmap puts out of scope for v1. A second table in a second vocabulary is exactly how a defence value gets tuned in one place and read from the other.

For reference while reading the formula above: our six terrains run 0 stars (road, bridge, river) through 1 (plains), 2 (forest), to 4 (mountain).

### The numbers, and the shape they have to take

⚠️ **No attack stat and no defence stat, following AW** — which has neither. A
unit's toughness is not a property of the unit; it is every attacker's column
against it. Defence comes from terrain and nowhere else.

⚠️ **A triangle cannot come from stats, and that is arithmetic rather than
taste.** Give every unit an attack `A` and a defence `D` and let damage be any
`f(A, D)`, and the ordering that falls out is **transitive**: if infantry beats
cavalry and cavalry beats artillery, infantry beats artillery, necessarily.
Rock-paper-scissors is non-transitive, so no pair of scalars can express one.
The choice is only ever a matrix or a class system — and at three unit types a
class system is more machinery than the nine numbers it would save. AW kept an
explicit matrix at eighteen.

```ts
BASE_DAMAGE:      Record<UnitTypeId, Record<UnitTypeId, number>>           // 9
CHARGE_THRESHOLD: Partial<Record<UnitTypeId, Record<UnitTypeId, number>>>  // 6
FLANK_MULTIPLIER, REAR_MULTIPLIER                                          // 2
```

⚠️ **The directional terms multiply the threshold; they do not add to it.**
Additive constants stop meaning anything the moment the table underneath them is
retuned — halve every threshold and a flat `+20` goes from a nudge to an
override. A multiplier is scale-free, so the base table can move without
dragging these two behind it. They also read as what they are: a rear charge is
*twice as likely to break them*, not *twenty more points of something*.

⚠️ The effective threshold **floors**, like every other step in the formula, so
`25 × 1.5` is 37 rather than 37.5.

⚠️ A multiplied threshold can exceed 100, and then the charge is automatic
against any health at all. That is deliberate and it is the mechanic's signature
moment — cavalry into the rear of a battery — but it is also why a base number
wants checking *at all three multipliers* rather than head-on alone. A front
value that looks reasonable can saturate at the flank and make the rear
distinction dead weight.

Nested `Record`s give the same compile-error-on-incomplete property `TERRAIN`
and `UNIT_TYPES` already have: add a unit type and every incomplete row stops
building.

⚠️ **Charge capability is *having a row*, not a flag beside one.** The `Partial`
on the outside says not every unit charges; the full `Record` inside says one
that does needs a number against every target. Artillery simply has no entry —
so "can it charge" and "what are its thresholds" cannot disagree, because they
are the same fact. A `charge?` boolean on `UnitType` plus a table elsewhere is
two facts that can.

#### ⚠️ The triangle is not in one table

Each edge of it happens for a different reason, and each mechanic should carry
exactly one:

| | beats | how |
|---|---|---|
| **artillery** | infantry | by **shooting** — `BASE_DAMAGE`, and it should be brutal |
| **cavalry** | artillery | by **charging** — overrunning a battery is the classic cavalry action |
| **infantry** | cavalry | by **not breaking** — a frontal charge threshold low enough that it needs a nearly-dead target |

So cavalry's *shooting* numbers can be mediocre across the board — carbines from
horseback — because cavalry's identity lives in the charge table. And infantry's
advantage over cavalry is not damage at all. Splitting it this way is what keeps
tuning one table from smearing into another.

### Facing, which is charge's other half ⬜ — where we diverge ⚠️

**AW has no facing. This is ours**, and the second original mechanic in the game after charge. It earns its place on theme as much as on mechanics: the period's tactics *are* line, flank and rear, and it gives cavalry's speed a purpose beyond arriving sooner — getting behind something.

⚠️ **Facing is read by charge and by nothing else.** Shooting ignores it entirely — `computeDamage` sees terrain, HP and luck, and no direction at all. A charge into a formed front is very hard and needs a weak target; into a flank it is easier, and into the rear easier still. Only the *defender's* facing matters; the attacker's is irrelevant, exactly as in FFT.

**Three reasons, in the order they weigh.**

⚠️ **It collapses two untuned mechanics into one.** Facing and charge are the only two things here with no reference behaviour to check against, and this document already warns that tuning them together means moving two dials against one observation. Bound to each other they are a single mechanic with a directional term, tuned once — the hazard stops needing management because it stops existing.

**The history agrees.** Flank and rear fire was deadlier — enfilade, and fewer barrels bearing — but what decided this period's engagements was *melee and morale*, not volume of fire. Infantry in line or square repelled frontal cavalry almost routinely; cavalry into a flank or rear broke them. Position mattered because the charge landed, not because the shooting improved.

**And it prices facing proportionally.** Eight units a side, every one acting every turn, is sixteen moves a round that would each owe a facing decision whether or not it changed anything — and worse on a board dense enough that most units have enemies on two or three sides, where facing stops being a decision and becomes local damage-minimisation. Bound to charge, you think about it when you are contemplating the thing it governs.

⚠️ **No small shooting modifier as a compromise.** Either it is large enough to change decisions -- and every turn owes it a thought, and there are two dials again -- or it is too small to change one, and it is pure tax. A modifier that never changes a choice should not exist.

**The classification is arithmetic on a four-cycle** — one pure function in `shared/`, trivially testable:

```
(directionOfAttack − defenderFacing) mod 4   →   0 front · 1,3 flank · 2 rear
```

Adjacent attacks give an orthogonal direction. Ranged ones need not — a cannon three tiles away can sit diagonally — so the direction resolves by **dominant axis, with a perfect diagonal counting as a flank**.

**It enters charge as a threshold adjustment, not a roll.** ⚠️ And it **raises** the threshold rather than lowering it, which this document had backwards: `margin = targetHP − threshold` and `success = margin <= luckRoll`, so a *lower* threshold makes the margin **bigger** and the charge **harder**. A rear charge wants a higher threshold.

⚠️ **Additive, not per-matchup.** Three directions against nine matchups is twenty-seven numbers nobody can tune. One `matchupThreshold` per attacker-and-target pair plus a single directional adjustment — front +0, flank +N, rear +M — is **eleven**, and it keeps the advice below intact: tune the nine head-on, then the two.

**Infantry charges too.** The bayonet charge is period-real, and it is what keeps facing relevant in most engagements rather than only where cavalry happens to be. Artillery never charges. `charge?` is already optional on `UnitType`, and any unit may be a *target* regardless.

#### An override with a default, not a step

**Facing is chosen, but never demanded.** The destination step already reads *pick destination → see route → confirm*; facing inserts as *→ rotate →* between the last two, defaulting to the direction of travel, which is right most of the time. Confirm accepts the default; a rotate gesture changes it.

That default is what makes this affordable. Eight units a side over a forty-turn game is several hundred facing decisions, and most of them do not matter — a required step would tax every move in the game to price the few that do. FFT gets away with demanding it because it is slow and menu-driven by design; this is meant to feel closer to AW.

⚠️ **Sequencing, and the reason it is split across two phases: facing selection is pure friction until combat reads it.** So:

- **6f derived it** from the last step of the path, with no UI at all — built. Free, deterministic, and it stops units moonwalking.
- **Phase 7 let the player choose it** at the confirmation step — built. It came
  forward, ahead of combat reading it, which inverts the ordering argument below.
- **10a makes it mechanical**, with charge, because charge is the only thing that reads it. ⚠️ Moved here from 9f: phase 9 reads facing nowhere at all.

That ordering existed so the game would never ask for a decision that does
nothing, and phase 7 took the cost deliberately: the confirmation step had to be
built whatever happened to facing, so offering the direction there was nearly
free. ⚠️ **All of that is built and lives in `architecture.md` now** — 7.999
finished it by making the travelled direction the default and a direction an
override, which is what "chosen, but never demanded" above actually asked for.
**9f is the only part left**, and it needs no interaction work at all: the
command already carries `facing`, and nothing reads it.

⚠️ **Tune charge head-on before layering direction onto it**, which is now the *only* sequencing constraint left rather than one of two. Charge is already the one mechanic with no reference behaviour, an untuned threshold table and an untuned failure-damage function; rear-charge bonuses put a *second* untuned original mechanic in the same expression. Get charge behaving sensibly front-on first, then add the directional term — otherwise every observation is adjusting two unknowns at once.

**One quiet payoff:** the single-element path — legal at cost 0, so far justified only as "wait in place" — becomes **turn in place**, a real defensive action. A mechanic we had already decided to allow for other reasons acquires a purpose.

### The attack interaction

⚠️ **There is no direct/indirect category.** Every unit has a `{ min, max }`
range and everything may move *and* attack, so `canMoveAndAttack` does not
exist. A gun with `min: 2` is described, not classified — nothing branches on it.

**A counter fires when the attacker is inside the defender's own range.** One
predicate, no exceptions. Artillery caught at one tile still cannot answer,
because 1 is not in `[2, 4]` — the behaviour survives without a rule for it, and
counter-battery becomes possible, which AW forbids and history does not.

#### The panel is the confirm step

Every attack goes through a small panel anchored over the target: it previews
what would happen, and where more than one action is available it is also how
you choose. It is 8.999's confirm pane with numbers in it — same anchoring, same
DOM-over-canvas, and the camera-tracking `transform` already lives in the
renderer.

```
Volley — 34 damage, they answer for 22
Charge — 62% to break them
Hold   — face them, do not fire
```

⚠️ **It is shown for every attack, near or far**, not only where there is a
choice. Uniform because it is a *preview and confirmation* first and a chooser
second — at range 3 it shows one option and a confirm, which is still the number
you wanted before committing.

⚠️ **No hover affordances, because touch has no hover.** The preview cannot ride
on pointer-over or the game is uninformative on a tablet. Naming that constraint
is what turned up the **route preview**, which was hover-driven and therefore
absent on touch. 8.999 paid that off and built this pane doing it, so what
arrives here is the pane plus numbers rather than the pane.

⚠️ **The camera does not need freezing, and this used to say it did.** The old
argument was that projecting once and tracking nothing avoids a React commit per
frame, with camera-tracking named as a future escape hatch. 8.999 takes that
escape as its default — the renderer writes `transform` in the render loop while
React owns only the content — so the panel already follows the board for free and
a freeze would buy nothing. ⚠️ What 8.999 does *not* solve and this step
inherits: `Vector3.Project` has no clipping, so a target the camera has pushed
off screen needs the panel hidden rather than positioned into the void.

#### What a click means, and in what order

**Action selection** (8.999's name for it) already reads the tiles around the
unit as a menu. Attacking adds one more reading of a click being read anyway:

| clicked | means |
|---|---|
| the unit itself | **hold**, keeping the direction it travelled |
| an adjacent *empty* tile | **hold**, facing that way |
| any enemy in range | open the panel |
| anything else | cancel |

⚠️ **The order those are asked in is load-bearing**, and nothing in the code says
so. `facingChoiceAt` returns a `Facing` for *any* adjacent tile — it never looks
at occupancy — so an adjacent enemy answers both "face this way" and "attack
this". Ask the target predicate first or an adjacent enemy can never be attacked,
and it is one reordered branch away from that.

**Attacking faces the target**, so the only difference between a facing click and
an attack click is whether somebody is standing there. ⚠️ Which is why **hold**
has to be in the panel: the one tile that faces an enemy is the tile they occupy,
so without it a weakened unit could never turn to face a neighbour without
shooting and taking a counter it might not survive. It is also the only thing
artillery can do to something that has reached it — `min: 2` means it cannot
fire, and it has no charge.

### Counter-attacks

**Iff the attacker is inside the defender's own range**, and the defender survives. One predicate, no categories. The defender counters using its post-damage HP.

⚠️ **AW's rule looks categorical and is not.** It reads "both units must be direct", but that is equivalent to *the attacker is adjacent and the defender can fight at adjacency* — because in AW a direct unit can only ever attack from range 1, so "direct attacker" and "adjacent attacker" are the same statement. Days of Ruin's Anti-Tank is the proof: indirect out to three, but **no minimum range**, and it counters. Under the category reading that needs a special case; under the geometric one it falls out.

⚠️ Ours differs from AW's in exactly one case, deliberately: **counter-battery**. Two guns at a range each can reach answer each other, which AW forbids and history does not. Artillery caught at one tile still cannot answer, because 1 is not in its band — the property worth keeping survives without a rule naming it.

**Not a special case.** A counter is `computeDamage` applied in the other direction with the defender's reduced HP — the same function, called twice. If it becomes a branch inside the attack resolver rather than a second call, that's the smell.

### Damage preview

The sharp edge of invariant 8, and AW shows one before you commit. The client runs the same `computeDamage` the server will, with the roll set to zero.

⚠️ **That is no longer an estimate — it is an exact lower bound, and the upper bound is free.** When luck was folded into the base it scaled with everything else and "omit the luck term" gave a number that was merely close. Luck is added **last and flat**, so the true outcome is exactly `[d, d + LUCK_MAX]` where `d` is the zero-roll result. The panel can therefore show a **range** rather than a point, and be right about both ends.

**Preview the formula, never the dice** still holds and is the reason this is safe: the client is told the shape of the outcome, never which of the ten it will be. Showing a range is strictly more honest than showing a single number the server was always going to miss.

### Combat resolution — what the client is told

**One event per battle**, not one per effect:

```ts
{ type: 'battleResolved',
  kind: 'volley' | 'charge',
  attacker: { unitId, health },   // resulting
  defender: { unitId, health },   // resulting
  answered: boolean }             // the defender hit back: a counter, or a repel
```

⚠️ **Split events when the parts are independently meaningful; keep them
together when they are one fact.** A charge's displacement is a separate
`unitMoved` because the move is a fact on its own with an animation already. But
a counter-attack exists *only because* the attack happened — it is not a second
fact, it is half of one. Splitting it would make the client infer which damage
events belong to which exchange, and the only signal available is position in a
batch, which a multi-action catch-up breaks.

It survives invariant 9 intact: resulting healths are absolute, applying it
twice is a no-op, and it makes sense against the state before it. The invariant
forbids **deltas** and **interdependence**, not cohesion.

⚠️ **No `unitDied`, and no `died` flag.** `health: 0` is the marker, and a flag
beside the number could disagree with it. The rule is stated once — *a unit at
zero health leaves the board* — in the reducer. ⚠️ **No `unitAttacked` either**:
events are named for the effect rather than the act, which is why `unitAttacked`
became `unitDamaged` and then dissolved into this. `unitMoved` is the resolution
of a move; this is the resolution of an attack.

**What it carries, and why that is enough.** The *record* needs only resulting
healths: `resolutions` stores the **action** beside the events, so base damage,
terrain and the expected-at-zero-roll all recompute from the action plus the
pre-state — which makes the **roll** recoverable as `actual − expected`, and a
counter identifiable as *the attacker's health dropped on its own turn*.

⚠️ **But the client is a second consumer with less information.** `EventsResponse`
is `{ seq, events, state }` — it never sees the action. So `kind` earns its place:
a volley and a charge look nothing alike, and the kind lives only in the action.

⚠️ **`answered` earns its place on a stricter test: a field is redundant only if
it is *always* derivable.** The client would otherwise infer a counter from the
attacker's health dropping — which works only while every counter deals at least
1. That is true of the current table and guarded by the harness sweep, but it
means **presentation would rest on tuning**, and a table change could silently
delete an animation. A counter that deals zero is a real outcome and
indistinguishable from no counter at all, so the fact is carried rather than
guessed. `answered: true` with the attacker's health unchanged is *consistent*,
not contradictory: they fired and it did nothing, which the client should show.

`kind` does the rest of the work — in a volley the attacker losing health is a
counter, in a charge it is a repel — so no third field is needed to say which.

#### How it is shown

| event | the client plays |
|---|---|
| `unitMoved` | walks the mesh *(built)* |
| `battleResolved` | extinguishes ring segments down to the new health, awaits |

⚠️ **The mesh is guaranteed alive while a death animates.** Removal happens in
`syncUnits`, which runs *after* `playEvents` resolves — so a death has somewhere
to play without anything being arranged for it.

**The board shows a ring, not a number or a bar.** Ten segments at the unit's
base, hidden at full health, extinguishing rather than dimming — bands are
discrete, so a segment going dark is honest where a fade would imply a
continuum. ⚠️ Ten segments for ten bands means **the display cannot promise
precision the rules do not have**, which is the question *HP representation* left
open. AW shows a number on the board and keeps the bar for the cutaway; this is
the same split with different furniture. An exact figure belongs to a
selected-unit info panel, later.

⚠️ It is **parented to the unit node**, so it rides the walk animation for free —
and therefore turns with the unit. Accepted: a ring is rotationally symmetric,
so only the segment boundaries move. Fixing it properly means splitting position
and rotation onto two nodes, which rewrites `createUnitMesh`,
`animateUnitAlongPath` and `getUnitFacing`'s exactness argument. Not worth it
yet.

⚠️ **No floating damage numbers.** They look like the cheap option and are not:
a number needs the *before* health, which needs local folding — the piece 9f
deliberately parks. The ring tweens to an absolute value the event already
carries and says the same thing for none of that.

#### The cutaway — the thing this is all building toward

AW's battle view is the target: a scene that takes the screen, shows both units
as **squads of figures scaled to health**, plays the exchange, and hands back.
It is the reason the event carries what it carries, so it is specified here even
though it is far from built.

**What it plays, per outcome:**

| | the scene |
|---|---|
| **volley, unanswered** | attacker's squad fires, defender's figures fall |
| **volley, answered** | then the defender fires back and the attacker loses figures — one scene, two beats, which is why the exchange is **one event** |
| **charge, broke through** | the attacker rides in, the defender's line collapses entirely |
| **charge, repelled** | the attacker rides in, the line **holds**, and the attacker is thrown back losing figures |

⚠️ **The two charge outcomes are the whole reason `kind` and `answered` exist.**
A repelled charge and a countered volley end in the same arithmetic — the
attacker lost health — and look nothing alike. Without both fields the client
would have to guess which animation it is, and `answered` is what tells it the
line held rather than nothing happening.

⚠️ **Nothing here forecloses it**, which is worth knowing before designing around
a constraint that does not exist: `playEvents` returns a promise the hook awaits,
so a modal battle scene is just a promise that takes longer. No signature
changes, no new callbacks, no change to how state commits.

Two things it will need that do not exist yet:

- the **before** health for both units, to animate figures falling rather than
  appearing at a new count. The route is already chosen — fold locally inside
  the queue task, never change the callback signature.
- **squad figures**, which are cheaper than they look: models are already
  instanced per unit, so this is `ceil(health / 20)` copies of a mesh we own,
  arranged in a row. ⚠️ **No new art**, which is normally what kills a feature
  like this before it starts.

⚠️ **Where it lives is undecided and does not need deciding yet** — a second
Babylon scene drawn over the board, or a DOM layer. The seam is the same either
way, which is the point of specifying the seam first.

⚠️ **One accepted limit:** a snapped batch (over the tile threshold, or a hidden
tab) skips `playEvents` entirely, so deaths happen instantly with no animation.
Correct — snapping is snapping — but it means the game has to stay readable
without the animation, which is another argument for the ring over an effect.

### Range — no categories at all

```ts
range: { min, max }
```

⚠️ **"Direct" and "indirect" do not exist here**, not even as a category that falls out of the numbers. They are AW's name for three properties that happen to move together in *its* roster — minimum range, whether you may move and fire, and whether you counter — and no AW unit breaks the correlation, so it is impossible to tell from behaviour which is causal.

We decouple all three. **Everything may move and fire**, so `canMoveAndAttack` does not exist. **Counters are geometric**, so nothing tests a category. What is left is two numbers: a gun with `min: 2` is *described*, and no branch anywhere asks what kind of unit it is.

No line-of-sight system. AW never had one either.

### Charge

A distinct attack type, chosen instead of firing on a given turn, consuming `hasActed` either way. Capability is a row in `CHARGE_THRESHOLD` rather than a flag — see *The numbers* above; any unit can be a *target* regardless. **This has no AW equivalent** — it's our melee model, and the one part of combat with no reference behaviour to check against.

Requires the attacker to be able to enter the target's tile — reads the terrain table, so if the target's terrain is impassable to the attacker's movement type, charge isn't available.

```
threshold = floor(matchupThreshold% × directionalMultiplier)
margin    = max(0, targetCurrentHP% − threshold)     // raw health, not banded
chance    = max(1, round(100 × 0.5 ^ (margin / CHARGE_HALF_LIFE)))
success   = roll < chance                            // roll is 0..99
```

⚠️ **Exponential decay, and the shape is the point.** Every `CHARGE_HALF_LIFE`
points of health above the threshold halves the odds — one dial with a sentence
you can say out loud. At or below the threshold it is certain; above it the
curve falls away but **never reaches zero**, so cavalry into a full-health line
is a long shot rather than a wall. At a half-life of 15 that reads 3% head-on,
5% from the flank, 10% from the rear.

⚠️ **The 1% floor is stated rather than emergent.** Exponential decay never
mathematically hits zero, but integer percentages do, and a silent 0% would
contradict the whole design.

⚠️ **An earlier draft compared `margin` against the damage luck roll**, which
made the entire uncertain window nine health wide — guaranteed at 25, impossible
above 34, and a cliff between. It also rendered the directional multipliers
nearly inert, since they mostly converted *impossible* into *impossible*. The
curve is what lets facing change a decision instead of a rounding.

⚠️ **Raw health, deliberately not banded** — and this was measured, not assumed.
Damage bands because raw health broke it: a unit at 1% dealt zero. Charge has no
such failure, so banding here buys only cosmetic agreement with the board ring
and costs two things for it. Fully banded, any multiplier under ×1.4 vanishes
outright — `band(25)` and `band(28)` are both 3, so a ×1.15 flank bonus becomes
*literally identical* to head-on at every health. Banding the target but not the
threshold avoids that but makes the table lie: `ceil` rounds the target up, so a
unit sitting exactly on a stated threshold of 25 shows **79%**. Raw health hits
100% at exactly 25 and moves on every point of damage.

`directionalMultiplier` is 1 head-on, `FLANK_MULTIPLIER` from the side, and
`REAR_MULTIPLIER` from behind. ⚠️ **They have to be worth manoeuvring for.** At
×1.15 the flank moved 20% to 23% — inside the noise, a rule to learn that never
changes a decision. ×1.5 and ×2 move the curve enough to be a reason to ride
around someone.

- **Success**: the target takes damage equal to its remaining health, and the
  attacker displaces onto the vacated tile. ⚠️ Expressed as *damage to zero*
  rather than "it dies", which is what lets a charge be an ordinary
  `battleResolved` with no special case in the reducer.
- **Failure**: the attacker takes `CHARGE_REPEL` scaled by how badly the charge
  missed, and does not move.

⚠️ **A charge does not consult the counter rule at all.** That rule — *the
attacker is inside the defender's range* — is a question about **shooting**, and
a charge is not shooting. Applying it here would make charging **artillery free**,
since `min: 2` means a battery cannot answer at contact — the one unit cavalry
exists to punish would be the only one unable to punish back, which inverts the
triangle. The repel damage **is** the defence, and every defender has it: the
battery firing canister at point-blank is the mechanic, not an exception to it.

⚠️ **`CHARGE_REPEL` is one value per defender type** — `Record<UnitTypeId,
number>`, three numbers, keyed by who is being charged. How hard a unit punishes
a failed charge is a real difference between units, not a global constant:
infantry with bayonets fixed and a battery firing canister are doing different
things, and both differ from a unit simply being run into.

⚠️ **Keyed by the *defender* only, not by the matchup.** What a unit does when
cavalry hits its line is about its own equipment, not about who is arriving —
and the attacker-versus-defender dimension is already spent on
`CHARGE_THRESHOLD`. The split is worth stating: **the threshold says how likely
the charge is, the repel says what failing costs.** Two questions, two tables,
neither doing the other's job.

⚠️ **This is not the "defence stat" the damage design refuses.** That refusal is
about *damage*, where a scalar defence would force a transitive ordering and
make a triangle impossible. Repel takes no part in the damage formula and orders
nothing — it is a punishment, not a toughness.

⚠️ Reusing the defender's own `BASE_DAMAGE` was considered first and refused:
artillery's 60 was tuned as *ranged* fire, and borrowing it at contact asserts a
battery is as dangerous close as far, which is the opposite of what `min: 2`
exists to say. Its own table says what canister does without disturbing what
round shot does. **Tuning count goes from seventeen to twenty.**
⚠️ **Undecided: which direction the scaling runs.** "Barely failed, barely hurt"
rewards a near-miss; "wilder charge, worse mauling" punishes recklessness. They
feel very different and no number can tell you which you want.

Fire and charge are **different resolutions, dispatched once** on an `attackKind` discriminant — fire produces damage, charge produces death-plus-displacement or a backfire. Two self-contained functions, not conditionals threaded through one.

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
| **infantry** | 30 | 35 | 45 |
| **cavalry** | 20 | 25 | 30 |
| **artillery** | 75 | 60 | 40 |

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

`FLANK_MULTIPLIER 1.5`, `REAR_MULTIPLIER 2`, `luckMax 9` — the last matching AW
exactly, since `baseDamage` is a percentage in both schemes.

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

**The harness exists** — `packages/shared/scripts/matchups.ts`, run with `bun`. It prints hits-to-kill across every matchup and terrain, which is the artefact worth tuning against; a raw damage number is not. It has already earned itself twice: it killed a first table where everything died in two hits, and it settled the mountain question above. ⚠️ Its details belong to [`architecture.md`](architecture.md) now, not here.

*Sources: [Wars World News — Battle Mechanics](https://www.warsworldnews.com/wp/aw/game-aw/battle-mechanics/) · [AWBW Wiki — Damage Formula](https://awbw.fandom.com/wiki/Damage_Formula) · [Advance Wars Wiki — Luck](https://advancewars.fandom.com/wiki/Luck) · [AWBW Wiki — Terrain](https://awbw.fandom.com/wiki/Terrain) · [Advance Wars Wiki — Indirect Combat](https://advancewars.fandom.com/wiki/Indirect_Combat)*


## Open questions

- ~~**Counter-attack for `min > 1` units.**~~ ✅ Settled: a counter fires when the attacker is inside the defender's range, whatever that range is. A gun answers a gun at reach and cannot answer anything at one tile — both from the same predicate, neither from a rule about it.

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
| **`shared/`'s test files are not typechecked** | Nothing imports them, so they never enter a program `tsc -b` builds. Verified both ways: a deliberate type error in a `shared` test passes the typecheck, the same error in a source file fails it. They are verified by running instead. ⚠️ **A directory of `shared`'s own *can* be checked without touching purity**, which this entry used to imply was impossible: a sibling tsconfig with its own `types` covers `include: ["scripts"]` alone, leaving `src`'s config untouched. That is how the tuning harness gets checked — no `composite: true`, no new dependency | `bun:test` types in a `shared` program, which today means `@types/bun` as a dependency of the package whose defining property is having none — and that would also let `import … from 'bun'` typecheck inside the rulebook. Either a hand-written minimal declaration plus a lint rule closing the purity hole, or leave it |
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

### 9 — Combat: the smallest thing you can win

Terrain and pathing already exist, so the numbers mean something. The integration risk here is the chain — command → resolve → events → animate → death → mesh removal → victory — not the damage formula.

⚠️ **Nothing original is in this phase.** Facing and charge — the only two mechanics here with no reference behaviour — both land together in phase 10, so everything below can be checked against Advance Wars. That is the point of splitting them out: a phase that can be wrong in a way a reference will tell you about, followed by a phase that cannot.

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
  measurements behind it (*The damage formula*).

- **9f** `MoveCommand` gains an **optional** attack — path, facing, and a target, atomic. ⚠️ Called `UnitActionCommand` here for years, which oversold it: an optional field is *additive*, so the wire stays compatible, `parseCommand` keeps its existing branch and no stored row changes meaning. Whether the rename earns its churn is a real question and the answer is probably no. Simplest resolution: `computeDamage` from 9c, a target inside the range 9d gave the attacker, no counter yet and no charge. Damage and death events. ⚠️ **Facing is not read here and `computeDamage` takes no direction** — that moved to 10a with charge, which is the only thing that reads it. The command carries `facing` as it already does, and nothing does anything with it. Touches **four** places, not the three this used to claim: `parseCommand` for the wire shape, `validateMove`'s successor for legality, `resolveMove`'s for the events — and `moveCommandFor` in `interaction/selection.ts`, which is what actually builds the command on the client and changes shape with it.

  ⚠️ **Rolls are a third argument to `resolveAction`, not a field on `Action`.** The doc has said both. They cannot live on `Action`: `validateCommand` is its only constructor and has no business generating or receiving a roll.

  ⚠️ **One roll here, not a sequence.** 9f has no counter and no charge, so it needs exactly one number — building the second slot early is the thing this phase condemns elsewhere. When 9g adds the counter it becomes a **named object**, `{ attack, counter }`, widening to `{ attack, counter, charge }` in 10a. Named rather than a tuple: `rolls[0]` is positional and anonymous where `rolls.attack` says what it is, and 10a's third draw extends cleanly instead of adding a nameless slot. Either way an *array* is refused — `rolls[2]` is `undefined`, which is `NaN` damage, the same silent shape as a stored unit with no `health`.

  ⚠️ **The charge roll is a different kind of number.** Damage luck is `0..LUCK_MAX` added to a result; the charge roll is `0..99` compared against a percentage. They share a bag and nothing else.

  ⚠️ **One signature, and `endTurn` ignores its rolls.** The alternative — only the attack resolver taking them, with the dispatcher pulling the argument apart — spreads the decision across two places to spare one branch an unused parameter. Taken deliberately; it is a wart either way and this is the smaller one.

  **`Math.random()` on the server is sufficient, and that is invariant 9 paying off.** Events carry *resulting* values rather than inputs, so a replay reads what happened and never re-rolls. There is nothing to reproduce: no seed, no PRNG inside `shared/`, no determinism machinery. Most games need all three.

  ⚠️ **No `rolls` column, and the reason is a decision already made.** An earlier draft wanted one so an outcome could be decomposed into base, terrain and luck. It is unnecessary: luck is added **last and flat**, so `roll = actualDamage − computeDamage(preState, attacker, defender, 0)`, and the pre-state replays from the log while the damage comes from the event. **The log already contains the roll.** That removes a schema change, a write path, and a migration — which would have been the *third*, not the second: `0000_silent_prodigy` and `0001_far_roulette` both exist.

  ⚠️ **Invariant 9 constrains the events.** `unitDamaged { unitId, health }` carries the *resulting* HP, not the damage dealt — a delta applied twice deals it twice. Damage is `before − after`, which the client can compute from the state preceding the event. ⚠️ Named for the effect rather than the act, because **three different things reduce HP**: the attack, the counter, and a failed charge's backfire — and the last two land on the *attacker*. `unitAttacked` implies a direction the event does not have. ⚠️ **`applyEvents.ts` has not heard about the rename.** Its doc comment is the canonical statement of invariant 9 — the place somebody reads to learn the rule — and it still says `unitAttacked` must carry the resulting HP. Drift this doc created, and it is fixed here or not at all.

  ⚠️ One nuance the client will hit here, parked by 5b with its answer attached: in a multi-resolution catch-up batch, "the state preceding event *k*" is the pre-batch replica folded through events 1..k−1 — a second hit on the same unit computes its damage number from the intermediate HP, not the pre-batch one. If the animation needs that, thread a **locally** folded state through the animation walk (`applyEvents` as a plain helper inside the queue task) — never per-event React commits, never a callback-signature change. Large batches snap without animating anyway (5b's threshold), so this only matters for small ones.
- **9g** Counter-attacks. ⚠️ **Fires iff the attacker is inside the defender's own range** and the defender survives — one predicate, and "both units are direct" is gone with the category it named. `computeDamage` called a second time in the other direction, on the defender's post-damage HP. **If it becomes a branch inside the attack resolver rather than a second call, that is the smell** the Combat section warns about.

  ⚠️ **This is what makes the matchup numbers mean anything.** Attacking in AW is an *exchange*: the question is never "can I kill it" but "is the trade worth it". Without a counter, every attack is free and hits-to-kill says nothing about whether to throw the punch.

  ⚠️ **Damage scales with health, and the counter is computed on the reduced HP** — both already in the formula. A wounded attacker hits softer *by band*, and a wounded defender loses its terrain cover, since the defence term scales by defender band too. ⚠️ **Which makes the counter lumpy**: a hit that pushes the defender across a band boundary cuts its reply, while one that leaves it inside the same band does not — so the exchange turns on where the boundaries fall, not just on how much damage was dealt. So striking first compounds: you hit them, they are weaker, and their counter is weaker for it. That is most of AW's exchange calculus and it falls out of the formula rather than needing a rule.

  ⚠️ And a counter can **kill the attacker**, which shrinks the attacker's roster mid-turn — so `actionsAllowed` drops and their turn can end sooner than they expected. Correct, since you cannot act with a dead unit, but nothing has written it down and this is where it first fires.
- **9h** ⚠️ **Mostly built, and smaller than it was.** Phases 7, 7.999 and 8.999 delivered the whole destination-and-action interaction: pinning, the confirm step and its pane, the client-side walk, and a `destinationChosen` whose lit tiles *are* the menu — the unit itself waits, a tile beside it faces that way, anything else cancels. **What remains is one more reading of a click already being read**: an enemy this unit can attack from the pinned tile. ⚠️ **No `choosingTarget` member** — that was the old plan and it is explicitly dropped; a target is a click in the state that exists, not a state of its own. What it does need is an attack-range overlay in a **reddish** tint, so a target is told from a facing choice by colour rather than by a rule.

  ⚠️ **The damage preview is part of this step, not a later one.** It used to be scheduled after, as polish. It cannot be: the panel *is* how an attack is committed, and a panel with no numbers in it is a bare confirm dialog. This is where *deterministic preview, yes; random resolution, no* stops being a slogan — the client runs the same formula with the luck term dropped.

  ⚠️ **And this is where `hold` earns its place in the panel** rather than being a nicety: see *The attack interaction* above for why the tile that faces an enemy is the tile they are standing on.

  ⚠️ **Two options in this phase, not three.** The worked panel above shows `Volley / Charge / Hold`, which is the phase-10 end state — charge does not exist until 10a. Build the two-option panel and let 10a widen it; standing a stub in the third slot is how the stub becomes permanent.

  **8.999 left less to do here than this step assumes.** The anchored DOM pane exists, and `anchorTo` takes one element — enough, because the confirm pane belongs to movement selection and the panel to action selection, so they can never both be up. The attack-range overlay is `createTileOverlay` with a new colour.

  ⚠️ **"An adjacent enemy means attack" is shorthand that breaks artillery.** A `min > 1` unit cannot hit an adjacent enemy at all and its targets sit two or three tiles out, so this lights **two sets** and the predicate is "an enemy *this unit can attack from here*". The colouring carries it: an adjacent enemy an artillery piece cannot reach simply stays the neutral facing colour. Undecided is only whether that reads oddly in the melee case, where one tile is both a facing choice and a target.

  Follow the shape already there: `facingChoiceAt` and `holdFacing` each read a click and answer `Facing | null`, so a third predicate answering `Unit | null` sits beside them, and the hook picks whichever answers. ⚠️ The pure decision belongs in `interaction/selection.ts`; the *dispatch* stays in `clickTile`, which is what has kept `handleTileClick` selection-only through two reworks.

  Nothing is needed from the renderer but the overlay. The route question that used to sit here is closed: the range and the route both come down when the menu lights, and the unit standing at the destination is what anchors the tiles around it.
- **9i** ⬜ **Health has to be visible**, and was missing from this phase entirely. 9b put `health` in the model and 9f makes it change, but nothing draws it — a unit at 40 reads identically to one at 100, which makes combat unplayable by eye and unverifiable in the browser, the only check the renderer has. Smallest thing that works: a billboarded bar or a scaled emissive band on the unit mesh, driven from `syncUnits` since that already runs per commit with the state in hand. It belongs before any tuning at all, because a matchup table whose results you cannot see is tuned by guesswork.

  ⚠️ **The facing marker moved to phase 10** — nothing reads facing until charge does, so a ground chevron here would be drawing a fact that changes nothing. 9i is the health bar and only that.

  ✅ **Settled: a ten-segment ring at the unit's base** — see *Combat resolution* above for the full shape and why a bar or a number was refused. Ten segments for ten bands is what stops the display over-promising precision the formula does not have.

  ⚠️ **And this step moves ahead of the combat command.** It is scheduled after 9f here for historical reasons and that ordering is wrong: the ring *is* the damage animation, so shipping combat first means shipping it with no feedback at all — health changing invisibly, units vanishing mid-frame, and the database as the only way to tell an attack happened. It is also what makes 9f checkable in a browser, which is the renderer's only check.
- **9j** Victory conditions. Elimination first: a player with no units loses. `GameState` gains a terminal marker so "finished" is a fact rather than re-derived, `validateCommand` refuses everything once set, and a `gameEnded` event tells clients to stop. The marker is **absolute like every other event payload** (invariant 9) — it carries the winner, not "the game ended", so applying it twice is a no-op.

Without 9j the board reaches a state where one side has nothing left and End Turn keeps working forever.

**Does 9f roll?** Yes. The step reads "damage from a table" and also "plus rolls", which is a contradiction worth settling in favour of rolling: the rolls plumbing — the server generating them, `Action` carrying them, resolution taking them as an argument so `shared/` stays pure — is the only *structurally* new thing in 9f, and it is what makes 9j's preview mean anything. A deterministic first cut would defer exactly the part worth proving.

**Keep game outcome separate from lobby status.** An outcome is a fact about the board — produced by a reducer, replayable from the log — so it belongs in `GameState`. "Waiting for an opponent to join" is about *users*, belongs on the `matches` row, and no reducer should know about it. A single `status` field spanning both is the muddle to avoid.

⚠️ **The board's vocabulary gets judged here, and nowhere earlier.** Terrain has exactly two mechanical dimensions — `cost`, which movement reads, and `defense`, which `computeDamage` now reads. So a terrain differing only in `defense` was *indistinguishable in play* until 9c, and one differing only in `cost` mostly duplicates what `river` already is: passable on foot, shut to horse and wheels. That is why renaming `mountain` to something the period would recognise buys accuracy and nothing else, and why new types are worse than nothing until the numbers they differ by are read by something. ⚠️ **And the count is five, not six.** `road` and `bridge` are mechanically the same terrain — `defense: 0` both, `cost: { foot: 1, horse: 1, wheels: 1 }` both — differing only in the character that draws them and the model that renders them. So the question this phase answers is whether *five* distinct terrains give enough tactical variety, which is a different question. Revolutionary-war terrain is a real want — fields, woodlots, orchards, marsh, and stone walls above all — but the first three are a **palette** job that touches no rule (`terrainModels.ts` material overrides), and the last is not a tile at all: a wall gives cover *from one direction*, which makes it an **edge** feature against a grid that only has cells, and it multiplies with facing. Both halves of that belong after this phase can say whether six terrains give enough tactical variety.

**Where identity shows up.** Two bits of UI here need to know who the user is — a "your units that can still act" indicator, and a victory screen saying *You won* rather than *Blue won*. Get it from one function rather than inlining `state.currentTurn` at each call site. Hot-seat: whoever's turn it is, because two people share one client. With auth: the session. Same concept, different source — nothing to build in advance.

Selection doesn't need it: `canSelectUnit` is a game fact ("may this unit act"), and the server already rejects a command for a unit the actor doesn't own, because `actor === currentTurn` and `unit.owner === currentTurn` compose.

### 10 — Combat depth

⚠️ **This is where everything original lands**, facing and charge together, because facing is read by charge and by nothing else. Phase 9 is Advance Wars and checkable against it; this phase is not checkable against anything and has to be played.

One mechanic layered onto the pipeline **phase 9** proved — ⚠️ down from four, because ranged and counter-attacks moved into phase 9 where they belong. What is left is the half that cannot be checked against anything:

- **10a** Charge, `CHARGE_THRESHOLD`, and its own tuning pass. ⚠️ **Invariant 9 constrains its events**: a successful charge emits `unitDied` **plus** `unitMoved`, two independently-applicable events, not one compound event carrying both effects. (Moved here from 9f, which has no charge in it.) It gets its own step because it is the riskiest mechanic in the game: **the one part of combat with no reference behaviour to check against**, an untuned threshold per matchup, an untuned failure-damage function, and a success case that emits two events and displaces a unit. Everything else in phases 9–10 can be checked against AW; this can only be played.

  ⚠️ **Tune it head-on first, then add the rear-charge threshold reduction.** Facing is the other mechanic with no AW precedent, and a rear charge puts both unknowns inside one expression — every observation would be adjusting two dials at once. Front-on charge until it feels right, directional term second.

The **Open questions** entry on counter-attacks for `min > 1` units belongs to 9g and moved into phase 9 with it — it was decided when indirect fire and immobility were the same thing, and 9d separates them.

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

