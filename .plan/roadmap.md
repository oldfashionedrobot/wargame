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

**Ours, in our units** — the only version to build from:

```
damage = baseDamage × (attackerHP / 100) × ((100 − terrainStars × 10 × defenderHP / 100) / 100)
```

Both `/10`s become `/100` because we store and display 0–100 (see the next section). Taking the AW line literally is not a rounding difference: at 4 stars with a full-health defender it computes `100 − 4 × 10 × 10 = −300`, so mountains would *heal* the unit standing on them. `baseDamage` stays a percentage of a full-health target, exactly as AW's tables give it, so the matchup numbers transfer unchanged — it is only the HP terms that rescale.

Every step rounds down. Three things fall out of it:

- **A wounded attacker hits softer** — linearly, by HP fraction.
- **A wounded defender loses its cover.** Terrain defence scales by *defender* HP, so a 4-star mountain protects a full-health unit far more than a nearly-dead one. This accelerates kills and stops damaged units turtling on good ground.
- **Terrain is not a minor modifier.** Four stars at full health is a 40% reduction. Tuning a matchup table with defence stubbed to zero would produce numbers to throw away — which is why terrain comes first.

**Luck** adds 0 to +9 to `baseDamage`, itself scaled by attacker HP: each point of health lost narrows the luck range by 1%, floor of +1%. Because `baseDamage` is a percentage in both schemes, this term needs **no rescaling** — the 0–9 is already in our units, and the "each point of health" that narrows it is AW's 1–10 point, so ours narrows per 10 HP. So damaged units are less swingy as well as weaker. *(Sources disagree slightly on where luck enters relative to the HP multiplier; the magnitude is consistent.)*

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

### Facing and directional defence ⬜ — where we diverge ⚠️

**AW has no facing. This is ours**, and the second original mechanic in the game after charge. It earns its place on theme as much as on mechanics: the period's tactics *are* line, flank and rear, and it gives cavalry's speed a purpose beyond arriving sooner — getting behind something.

A unit takes full defence from the **front**, less from a **flank**, least from the **rear**. Only the *defender's* facing matters; the attacker's is irrelevant, exactly as in FFT.

**The classification is arithmetic on a four-cycle** — one pure function in `shared/`, trivially testable:

```
(directionOfAttack − defenderFacing) mod 4   →   0 front · 1,3 flank · 2 rear
```

Adjacent attacks give an orthogonal direction. Ranged ones need not — a cannon three tiles away can sit diagonally — so the direction resolves by **dominant axis, with a perfect diagonal counting as a flank**.

**It enters combat as a factor, never a branch.** A `directionalMultiplier` inside `computeDamage` alongside terrain, which means counter-attacks inherit it for free with the roles swapped: a unit that moved in to attack is facing its target, so its counter arrives at the target's front and takes full defence. No special case, exactly as counter-attacks are already specified to be a second call rather than a branch.

For **charge**, the natural knob is the *threshold* rather than the roll: a rear charge lowers `matchupThreshold`, so `margin = targetHP − threshold` shrinks and the existing formula carries it unchanged.

#### An override with a default, not a step

**Facing is chosen, but never demanded.** The destination step already reads *pick destination → see route → confirm*; facing inserts as *→ rotate →* between the last two, defaulting to the direction of travel, which is right most of the time. Confirm accepts the default; a rotate gesture changes it.

That default is what makes this affordable. Three units a turn over a forty-turn game is a hundred-plus facing decisions, and most of them do not matter — a required step would tax every move in the game to price the few that do. FFT gets away with demanding it because it is slow and menu-driven by design; this is meant to feel closer to AW.

⚠️ **Sequencing, and the reason it is split across two phases: facing selection is pure friction until combat reads it.** So:

- **6f derived it** from the last step of the path, with no UI at all — built. Free, deterministic, and it stops units moonwalking.
- **7 lets the player choose it** at the confirmation step — see phase 7, which brings this
  forward, ahead of combat reading it, and so inverts the ordering argument below.
- **8d makes it mechanical** — the command carries it and `computeDamage` reads it as a factor.

That ordering existed so the game would never ask for a decision that does
nothing. **Phase 7 accepts that cost deliberately**: the confirmation step has
to be built for the move/attack menu whatever happens to facing, and once the
player is already confirming, offering the rotate is nearly free. So the choice
arrives one phase before the mechanic that reads it — and only on *Wait*, which
is the branch with nothing else to derive an answer from.

⚠️ **Tune charge head-on before layering direction onto it.** Charge is already the one mechanic with no reference behaviour, an untuned threshold table and an untuned failure-damage function; rear-charge bonuses put a *second* untuned original mechanic in the same expression. Get charge behaving sensibly front-on first, then add the directional term — otherwise every observation is adjusting two unknowns at once.

**One quiet payoff:** the single-element path — legal at cost 0, so far justified only as "wait in place" — becomes **turn in place**, a real defensive action. A mechanic we had already decided to allow for other reasons acquires a purpose.

### Counter-attacks

**Only when both units are direct combat.** If either side is indirect, no counter in either direction. The defender counters using its post-damage HP.

Our `ranged.min === 1` ↔ direct mapping reproduces this exactly, so a counter fires iff both units have `min === 1`, the defender survives, and the attacker is within the defender's range.

**Not a special case.** A counter is `computeDamage` applied in the other direction with the defender's reduced HP — the same function, called twice. If it becomes a branch inside the attack resolver rather than a second call, that's the smell.

### Damage preview

The sharp edge of invariant 8, and AW shows one before you commit. The client computes it from the same formula with the luck term omitted — a deterministic estimate, explicitly not a prediction. The server rolls and decides the real number, which will differ. **Preview the formula, never the dice.**

### Ranged — one category, not two

```ts
ranged: { range: { min, max }, canMoveAndAttack: boolean }
```

`min === 1` behaves like AW direct fire (adjacent through max, symmetric counter-attack). `min > 1` behaves like indirect fire (can't hit adjacent, no counter given or received). The category falls out of the numbers; no separate flag.

`canMoveAndAttack` is independent of range category — a mounted archer can be indirect *and* mobile; a cannon indirect and static. AW ties these together (indirects can't move and fire); we don't, deliberately.

No line-of-sight system. AW never had one either.

### Charge

A distinct attack type, chosen instead of firing on a given turn, consuming `hasActed` either way. Capability lives on the attacker's `UnitType` (`charge?`), optional; any unit can be a *target* regardless. **This has no AW equivalent** — it's our melee model, and the one part of combat with no reference behaviour to check against.

Requires the attacker to be able to enter the target's tile — reads the terrain table, so if the target's terrain is impassable to the attacker's movement type, charge isn't available.

```
margin   = targetCurrentHP% − matchupThreshold%
luckRoll = random(0, luckMax)
success  = margin <= luckRoll
```

No clamp needed — it falls out of `luckMax` being bounded. `margin ≤ 0` always succeeds; a small positive margin needs a good roll; a margin above `luckMax` is impossible.

- **Success**: target dies, attacker displaces onto the vacated tile.
- **Failure**: attacker takes bonus damage scaled by `margin`, no position change.

Fire and charge are **different resolutions, dispatched once** on an `attackKind` discriminant — fire produces damage, charge produces death-plus-displacement or a backfire. Two self-contained functions, not conditionals threaded through one.

### Tuning

**Untuned**: `luckMax`, every charge threshold, the failure-damage scaling function, the flank and rear multipliers, and the whole damage matchup table.

**Two of those have no reference behaviour at all** — charge and directional defence are both ours, and they meet in the rear-charge threshold. Tune them **in sequence, never together**: the matchup table against AW's numbers first, then charge front-on, then the directional term. Each stage leaves exactly one unknown to move against an observation.

**Build the harness before tuning.** `shared/` is pure and rolls are inputs, so a script that runs the matchup grid and prints **hits-to-kill** — attacker × defender at full health on plains, then shifted by terrain — is roughly thirty lines and needs no browser. Hits-to-kill is the artefact worth tuning against; a raw damage number isn't. Without it, tuning means editing a table, restarting, creating a match, manoeuvring two units together, and reading one number.

*Sources: [Wars World News — Battle Mechanics](https://www.warsworldnews.com/wp/aw/game-aw/battle-mechanics/) · [AWBW Wiki — Damage Formula](https://awbw.fandom.com/wiki/Damage_Formula) · [Advance Wars Wiki — Luck](https://advancewars.fandom.com/wiki/Luck) · [AWBW Wiki — Terrain](https://awbw.fandom.com/wiki/Terrain) · [Advance Wars Wiki — Indirect Combat](https://advancewars.fandom.com/wiki/Indirect_Combat)*


## Open questions

- **Counter-attack for `min > 1` units.** "No counter given or received" was settled when indirect fire and immobility were the same thing. Now that `canMoveAndAttack` is independent of range category, it is worth re-checking whether the rule should still key off `min > 1` alone. **Owned by 9b**, which is where it stops being answerable in the abstract.

## Known compromises

Deliberate limits of the current design, and what each would take to lift. Distinct from *Out of scope for v1* below, which is unbuilt features rather than accepted limits.

| | Current state | What it needs eventually |
|---|---|---|
| **Session identity** | Opaque id in an httpOnly cookie; the server trusts it on sight | Phase 10 — OAuth sign-in and a real session record. Same cookie, real meaning. No passwords at any point |
| **`actor` under hot-seat** | Server stamps `currentTurn` on its one connection | Phase 10 — session→player map established at join |
| **Matches are unowned and unbounded** | Anyone can create any number; no delete, no expiry. `list()` is capped at 50 newest — a bound, not pagination | Phase 10 — scope listing to the player, and add deletion. Until identity exists there's nothing to scope by |
| **Async play** | Works already — a returning client fetches current state and resumes. What's missing is knowing a match is waiting on you | Phase 10 — match lifecycle and, eventually, notification. Not new mechanics |
| **Ruleset versioning** | None | Stamp a ruleset id on the match so old logs replay under the rules they were played with |
| **Maps live in code, not a table** | Modules in `server/maps/`; `map_id` is a plain text column with no foreign key. Fine at one map | A `maps` table once there are enough to select among — see below |
| **Terrain has to stay flat** | `screenToTile` intersects the `y = 0` plane rather than mesh-picking, so the day terrain gains real height, clicking a peak selects the tile behind it. Colours are placeholders too — gameplay before looks | Elevation is a later pass, and it has to answer the picking question before it draws anything |
| **Shared build step** | TS source consumed directly, bun-only | A build if the server ever moves off bun |
| **`shared/`'s test files are not typechecked** | Nothing imports them, so they never enter a program `tsc -b` builds. Verified both ways: a deliberate type error in a `shared` test passes the typecheck, the same error in a source file fails it. They are verified by running instead | `bun:test` types in a `shared` program, which today means `@types/bun` as a dependency of the package whose defining property is having none — and that would also let `import … from 'bun'` typecheck inside the rulebook. Either a hand-written minimal declaration plus a lint rule closing the purity hole, or leave it |
| **Migrations run at boot** | `migrate()` on startup, fine for one instance and ~0.4 ms once nothing is pending. Drizzle lists runtime migration as a first-class flow for monoliths, so this is a choice rather than a shortcut | `bun run db:migrate` as a deploy step, once there is more than one instance, a rolling deploy, or a reason to deny the runtime DDL rights |
| **Two reads per command** | `resolveActor` needs state to stamp `actor = currentTurn`, but `submit` owns the read | Phase 10 — `resolveActor` becomes a session lookup and the extra read disappears |

### Maps in a table

Revisit when there are **enough maps to choose among**, or when they stop being
written by developers. Random selection, filtering, a picker, or user-authored
maps all make them a library rather than a constant, and a library of
selectable rows is what a table is for.

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
- **Graying out acted units.** The mechanical restriction is in scope; the visual is a later UI pass — but note phase 8 asks for a "units that can still act" indicator, which is the same thing under another name. Whichever phase draws it, it should be one treatment, not two.
- **Manual routing.** Dragging out a deliberately non-optimal path. Unblocked by the protocol carrying a path and the server validating it — purely a matter of building the UI for it.


## Remaining phases

### 7 — Units you can tell apart, and a move you commit to

Groundwork for combat rather than combat itself. By the end of it the board
shows three distinguishable units a side, and a move is something you confirm
rather than something that happens on a click. Neither piece needs a damage
number to exist, and phase 8 is hard to play without both.

⬜ **Scope is settled; the step split is not.** Detail this before starting it.

**What is already built, and is not part of this.** Unit *types* are real:
`UNIT_TYPES` gives infantry, cavalry and artillery distinct movement types and
ranges, `classic.ts` places all three a side, and they already path differently
— cavalry and artillery cannot ford the river and must take the bridge. Player
colour is real too: `PlayerColor`, `Player.color`, and `PLAYER_COLORS` in
`units.ts`. There is no colour-assignment system to design. What is missing is
only that `createUnitMesh` draws the same cylinder whatever the `unitTypeId`.

#### Unit models

Three glTF models sit in `packages/client/public/models/` — `infantry`,
`cavalry`, `cannon`, one per unit type. Each is a single mesh with a single
material, `baseColorFactor` near-white, no textures, no UVs, no vertex colours,
no animations, and buffers embedded as base64. Player tint is therefore a
material assignment with nothing to fight, and each file is self-contained.

They are already unit-scaled and stand on `y = 0` — heights 0.57 / 0.64 / 0.39
against a 1.0 tile, footprints all inside one tile — so they drop in roughly
where the placeholder cylinder stands.

- Needs `@babylonjs/loaders`, the first Babylon package beyond core and the
  inspector. Keep the per-file import discipline the rest of the renderer uses.
- Load each model once and clone per unit.
- **They face `+Z`**, the glTF convention, which is also the direction
  `FACING_ROTATION` already calls north (`col→x`, `row→z`, both increasing).
  So model-forward needs no correction and no per-model field.
- ⚠️ **Handedness before rotation.** Babylon's scene is left-handed, glTF is
  right-handed, so the loader inserts a `__root__` node carrying the conversion.
  Reparenting the child mesh away from it drops the conversion and mirrors the
  model — which on a near-symmetric mesh reads as "facing backwards" rather than
  as anything obviously broken.
- Re-check movement by eye afterwards. These models are the first thing to make
  unit *type* visible on the board, so a cavalry that paths like infantry
  becomes noticeable here for the first time.

#### The confirmation step

Modelled on AW, which answers "how do you attack without moving?" by not having
the question: a unit's own tile is a legal destination, and the action menu
opens once a destination is chosen.

**There is one gesture — click a tile.** Whether a unit happens to stand there
is incidental, which is already how `handleTileClick` works. The rule is simply
that the selected unit's own tile joins the destination set; everything else
falls out of that.

```
click a unit's tile      -> selected, movement range shown          (as today)
click a destination      -> the unit walks there, CLIENT-SIDE ONLY
click its own tile       -> destination is where it stands
   -> menu: Wait | Attack | Cancel
        Wait    -> choose facing, then submit
        Attack  -> attack range, choose a target      (phase 8; not built here)
        Cancel  -> unit returns, selection clears, nothing was sent
```

**Nothing goes over the wire until the menu is answered.** This is the
substantive change: today a click on a reachable tile submits immediately. Here
the walk is a preview of an *uncommitted* move, so Cancel has to put the unit
back — the ghost position that 8e parked as polish becomes the requirement.

**Facing is chosen only on Wait.** Move-and-attack and attack-in-place both
point the unit at its target — the nearest of the four directions — so there is
no decision to offer. The player is asked exactly when nothing else can answer.

**Clicking the selected unit's tile stops meaning cancel.** It deselects today
(`selection.ts`); it becomes *pin in place*. Cancel moves onto the menu.

#### To settle before building it

- The step split, and what lands in which commit.
- Where the uncommitted position lives. It is ephemeral UI state, so invariant 7
  keeps it out of `GameState` — most likely the renderer's, with `SelectionState`
  gaining a member.
- Whether `MoveCommand` grows a `facing` field here or in 8d. It has to happen
  the moment the player can choose, and it retires 6f's derivation inside
  `applyEvents` in favour of `directionBetween` as the *client's* default.
- What the menu is made of: DOM over the canvas, or drawn in the scene.

### 8 — Combat: the smallest thing you can win

Terrain and pathing already exist, so the numbers mean something. The integration risk here is the chain — command → resolve → events → animate → death → mesh removal → victory — not the damage formula.

- **8a** — *moved to 6a.* The `UnitType` catalog wiring is a prerequisite of the terrain cost table, not a consequence of combat; see phase 6's hard dependencies.
- **8b** `Unit` gains `health`; update the starting units. (`unitTypeId` arrived in 6a.) **`maxHealth` does not go on `Unit`** — it is static per unit type, which is the exact distinction 6a exists to draw, and putting it on every instance would re-introduce the duplication that moving `movementRange` onto `UnitType` just removed. If every unit tops out at 100 it is a constant in `shared/`; the day one doesn't, it is a `UnitType` field. **No migration** — `Unit` lives inside `GameState`, which is a JSON blob, so the shape changes without the schema moving. That is the JSON-blob decision paying off, and it is why `map_id` in phase 6 is the first migration rather than this.
- **8c** `GameRenderer.syncUnits(state)` — mesh add/remove, required before anything can die. It grows out of 5b's `snapUnits` and runs where that runs: inside the hook's queue, after the batch's animation, before the commit. Assumes 5b landed — without the gated commit, reconciling meshes against a state whose events are still animating is exactly the ordering bug 5b retired.
- **8d** `UnitActionCommand` replaces `MoveCommand` — path, facing, plus optional attack, atomic. Simplest resolution: adjacent only, damage from a table, no counter-attack, no charge. Damage and death events. **Facing becomes mechanical here** — the command carries it and `computeDamage` reads it as a directional factor beside terrain — while the client still sends only the default 6f derives. The player does not get to choose until 8e, by which point choosing already matters. Touches three places, all separate now: `parseCommand` for the wire shape, `validateMove`'s successor for legality, and `resolveMove`'s for the events — plus rolls, which arrive as an argument to resolution so `shared/` stays pure.

  ⚠️ **Invariant 9 constrains the events.** `unitAttacked` must carry the target's *resulting* HP, not the damage dealt — a delta applied twice deals it twice. Damage is `before − after`, which the client can compute from the state preceding the event. And a successful charge emits `unitDied` **plus** `unitMoved`, two independently-applicable events, not one compound event carrying both effects.

  ⚠️ One nuance the client will hit here, parked by 5b with its answer attached: in a multi-resolution catch-up batch, "the state preceding event *k*" is the pre-batch replica folded through events 1..k−1 — a second hit on the same unit computes its damage number from the intermediate HP, not the pre-batch one. If the animation needs that, thread a **locally** folded state through the animation walk (`applyEvents` as a plain helper inside the queue task) — never per-event React commits, never a callback-signature change. Large batches snap without animating anyway (5b's threshold), so this only matters for small ones.
- **8e** The whole destination-and-action interaction, which was 6e until it became clear it has nothing to offer before a menu exists. Click a reachable tile to **pin** it and see the route; a second click on it **confirms**; a click on another reachable tile **re-targets**; a click on the unit or outside the range **cancels**. On confirm, the choice appears: *Attack* (only when something is in range from there) or *Wait*. `SelectionState` gains `destinationChosen` and `choosingTarget` as members, plus an attack-range overlay.

  It is one step rather than two because the pin-and-confirm flow is friction until it carries a choice: until 8d exists, the second click offers exactly one option, and click-to-move is strictly better. `handleTileClick` needs no new signature — it already returns `{ selection, command }`, so pinning is a selection change carrying `command: null` and confirming is the call that submits today.

  **The renderer gains `setRoute(path | null)`**: `null` follows the pointer, an array shows that route and ignores hover. Without it a pinned route flickers as the mouse moves.

  **The facing override lands here too** — a rotate gesture between route and confirm, defaulting to the travel direction 6f derives.

  ⚠️ **Superseded by phase 7**, which builds this whole interaction — and which also
  reverses the bullet that used to sit here. Walking the unit to the destination before
  confirming was parked as polish precisely because it animates an *unsubmitted* move and
  so needs a ghost position and a snap-back on cancel; phase 7 makes that the point rather
  than the objection. What remains for 8e is the *Attack* branch of the menu.
- **8f** ⬜ **Health has to be visible**, and was missing from this phase entirely. 8b puts `health` in the model and 8d makes it change, but nothing draws it — a unit at 40 reads identically to one at 100, which makes combat unplayable by eye and unverifiable in the browser, the only check the renderer has. Smallest thing that works: a billboarded bar or a scaled emissive band on the unit mesh, driven from `syncUnits` since that already runs per commit with the state in hand. It belongs before 8g, because tuning a matchup table you cannot see the results of is guesswork.
- **8g** ⬜ **The damage preview** — specified under Combat as "the sharp edge of invariant 8" and, until now, scheduled nowhere. The client computes the same formula with the luck term omitted and shows it on the target before the click commits. This is the step where *deterministic preview, yes; random resolution, no* stops being a slogan and becomes code, so it is worth its own commit rather than riding inside 8e.
- **8h** Victory conditions. Elimination first: a player with no units loses. `GameState` gains a terminal marker so "finished" is a fact rather than re-derived, `validateCommand` refuses everything once set, and a `gameEnded` event tells clients to stop. The marker is **absolute like every other event payload** (invariant 9) — it carries the winner, not "the game ended", so applying it twice is a no-op.

Without 8h the board reaches a state where one side has nothing left and End Turn keeps working forever.

**Does 8d roll?** Yes. The step reads "damage from a table" and also "plus rolls", which is a contradiction worth settling in favour of rolling: the rolls plumbing — the server generating them, `Action` carrying them, resolution taking them as an argument so `shared/` stays pure — is the only *structurally* new thing in 8d, and it is what makes 8g's preview mean anything. A deterministic first cut would defer exactly the part worth proving.

**Keep game outcome separate from lobby status.** An outcome is a fact about the board — produced by a reducer, replayable from the log — so it belongs in `GameState`. "Waiting for an opponent to join" is about *users*, belongs on the `matches` row, and no reducer should know about it. A single `status` field spanning both is the muddle to avoid.

**Build the tuning harness first** — specified once, under Tuning. It prints **hits-to-kill**, not raw damage or a distribution; that section argues why, and this one used to say something slightly different, which is how two harnesses get built. This is also the first real use of the purity invariant: `shared/` is pure and rolls are inputs, so the script needs no browser and no server.

**Where identity shows up.** Two bits of UI here need to know who the user is — a "your units that can still act" indicator, and a victory screen saying *You won* rather than *Blue won*. Get it from one function rather than inlining `state.currentTurn` at each call site. Hot-seat: whoever's turn it is, because two people share one client. With auth: the session. Same concept, different source — nothing to build in advance.

Selection doesn't need it: `canSelectUnit` is a game fact ("may this unit act"), and the server already rejects a command for a unit the actor doesn't own, because `actor === currentTurn` and `unit.owner === currentTurn` compose.

### 9 — Combat depth

Four mechanics layered onto the pipeline **phase 8** proved. (This said "phase 6" while phase 6 has no combat in it.) They were one sentence between them, which understated the last one badly — so, in order:

- **9a** `ranged: { range: { min, max }, canMoveAndAttack }` on `UnitType`. 8d hardcodes adjacency, so this is where the field is actually introduced and where "the category falls out of the numbers" gets tested: `min === 1` is direct, `min > 1` is indirect, no separate flag. `canMoveAndAttack: false` is where 6c's single-element path stops being a curiosity and becomes the only legal shape for a static unit.
- **9b** Counter-attacks. Fires iff both units are direct, the defender survives, and the attacker is in its range — `computeDamage` called a second time in the other direction, on the defender's post-damage HP. **If it becomes a branch inside the attack resolver rather than a second call, that is the smell** the Combat section warns about.
- **9c** Charge, its threshold table, and its own tuning pass. It gets its own step because it is the riskiest mechanic in the game: **the one part of combat with no reference behaviour to check against**, an untuned threshold per matchup, an untuned failure-damage function, and a success case that emits two events and displaces a unit. Everything else in phases 8–9 can be checked against AW; this can only be played.

  ⚠️ **Tune it head-on first, then add the rear-charge threshold reduction.** Facing is the other mechanic with no AW precedent, and a rear charge puts both unknowns inside one expression — every observation would be adjusting two dials at once. Front-on charge until it feels right, directional term second.

The **Open questions** entry on counter-attacks for `min > 1` units belongs to 9b and should be settled there rather than carried further — it was decided when indirect fire and immobility were the same thing, and 9a separates them.

### 10 — Multiplayer and auth

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

