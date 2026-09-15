import { attackSide, isWithinGrid, tileDistance } from './coordinate';
import { terrainAdmits } from './movement';
import {
  BASE_DAMAGE,
  CHARGE_HALF_LIFE,
  CHARGE_REPEL,
  CHARGE_THRESHOLD,
  REPEL_DIVISOR,
} from './data/combat';
import { clampHealth, getUnitType } from './data/unitTypes';
import type { UnitTypeId } from './data/unitTypes';
import { getTileAt, getUnit } from './queries';
import { getTerrain } from './data/terrain';
import type { BattleResolvedEvent, Coordinate, GameState, Unit } from './types';

/** How many ten-point bands of health a unit has left: 1 through 10, never 0. */
export const BANDS = 10;

/**
 * The health term the formula reads: AW's displayed 1-10, `ceil(health / 10)`.
 *
 * ⚠️ **This is the whole reason a living unit can still fight.** Health is
 * stored and shown as 0-100 here -- see *HP representation* in the roadmap,
 * where displaying 1-10 was rejected as a GBA screen constraint -- but the
 * *formula* reads the band, exactly as AW's does. Feed it raw health instead
 * and a unit on 1 point attacks at 1% rather than 10%, which floors to nothing:
 * measured, a cavalry unit at 4 health or less dealt **zero** to infantry in
 * forest even on a maximum roll. Two wounded units could then be permanently
 * unable to kill each other, and elimination is the only way a match ends.
 *
 * ⚠️ AW has no minimum-damage rule and does not need one; this is what it has
 * instead. Zero is still reachable at the extremes, which is faithful -- it is
 * just no longer a predictable band.
 *
 * The cost is deliberate and worth naming: a unit at 91 health and one at 100
 * fight identically while the bar shows two different numbers. That is the
 * price of AW's arithmetic, paid without AW's rounded display to hide it.
 *
 * ⚠️ **Exported because the board's health ring draws one segment per band**,
 * and its claim -- that the display cannot promise precision the rules lack --
 * is only true while the two agree. It computed `ceil(health / 10)` itself once,
 * in another package, in a different spelling; that made the claim a
 * coincidence rather than a consequence.
 */
export function band(health: number): number {
  return Math.ceil(health / BANDS);
}

/**
 * What `attacker` takes off `defender`, given a luck roll in `[0, LUCK_MAX]`.
 *
 * ```
 * damage = floor(floor(base × attackerBand/10) × (100 − stars×defenderBand)/100) + luck
 * ```
 *
 * ⚠️ **Both HP terms read the band, never the raw value.** One rule rather than
 * two: it is what keeps a wounded attacker able to fight at all, and applying it
 * to only one side would be half of AW's formula with no principle saying which
 * half. `baseDamage` itself needs no rescaling, because it is a percentage of a
 * full target in both schemes -- which is what lets AW's matchup numbers
 * transfer unchanged.
 *
 * ⚠️ **Luck is added last, flat, and is not scaled by anything.** This file
 * twice had it folded into the base *before* the health multiplier, which reads
 * naturally and is wrong: a ROM-derived reconstruction of the GBA engine finds
 * luck applied after every multiplication and truncation, as a plain addition of
 * true hitpoints. The difference is not cosmetic -- folded in, a weak attacker's
 * luck shrinks with it; added last, **luck is worth proportionally more the
 * weaker the attacker is**, and a nearly-dead unit's best roll is its only real
 * threat. Sources that describe luck as scaling with HP disagree with the ROM.
 *
 * Three behaviours fall out rather than needing rules:
 *
 * - **A wounded attacker hits softer**, by band.
 * - **A wounded defender loses its cover**, because the terrain term scales by
 *   *defender* band. A 4-star peak protects a full unit far more than a
 *   nearly-dead one, which stops damaged units turtling on good ground.
 * - **Striking first compounds.** You hit them, they are weaker, and their
 *   counter is weaker for it -- most of AW's exchange calculus, for free.
 *
 * Pure, and the roll is an input, which is what lets the tuning harness run the
 * whole matchup grid with no server and no browser.
 *
 * **Where this comes from.** AW's own formula, its luck behaviour, and the three
 * truncation points are documented across these; where they disagree, the
 * ROM-derived one wins, because it was measured against the engine rather than
 * described from play:
 *
 * - https://github.com/geno55/advance-wars-advisor -- ROM-derived damage engine.
 *   The authority for *ordering*: luck last, truncation after the HP multiply
 *   and again after defence.
 * - https://awbw.fandom.com/wiki/Damage_Formula -- the formula in AW's own units
 *   (HP 1-10), which is what the rescale note above is about.
 * - https://www.warsworldnews.com/wp/aw/game-aw/battle-mechanics/ -- terrain
 *   stars and the exchange model.
 * - https://warswiki.org/wiki/Damage/Advance_Wars_2_chart -- the base damage
 *   matrix the spread of `BASE_DAMAGE` was taken from.
 */
export function computeDamage(
  state: GameState,
  attacker: Unit,
  defender: Unit,
  roll: number,
): number {
  // ⚠️ A dead attacker deals nothing, including no luck. `band(0)` is 0, which
  // zeroes the base -- but luck is added *after* everything and would sail past
  // it, so a corpse would land 9. Nothing should be calling this with one; the
  // same is true of `getUnitType`, which throws rather than trust that.
  if (attacker.health <= 0) return 0;

  const base = BASE_DAMAGE[attacker.unitTypeId][defender.unitTypeId];

  const { defense } = getTerrain(state.grid[defender.position.row][defender.position.col]);
  // Cover is worth less the less there is left to cover. Bounded well under 100
  // -- the stoutest ground is 4 stars against 10 bands -- so the factor below
  // cannot go negative and no clamp is needed to stop terrain healing anyone.
  const cover = defense * band(defender.health);

  // ⚠️ Floored in sequence rather than folded: `floor(a × b × c)` and
  // `floor(floor(a × b) × c)` are different numbers, and the second is AW's.
  const scaled = Math.floor((base * band(attacker.health)) / BANDS);
  return Math.floor((scaled * (100 - cover)) / 100) + roll;
}

/**
 * Why this attack is refused, or null if it is legal.
 *
 * ⚠️ **`from` is where the unit *ends up*, not where it stands.** The command is
 * move-then-attack, so a range checked against `attacker.position` would be
 * measuring the wrong tile and would accept shots the unit cannot take. The
 * caller passes the destination deliberately rather than this reaching for a
 * position that is about to be stale.
 *
 * ⚠️ **No category is consulted**, because there is none. `range` is two numbers
 * and a band either contains the distance or it does not -- the same predicate
 * that makes artillery helpless at one tile also makes it deadly at four, with
 * no rule naming either case.
 */
export function refuseAttack(
  state: GameState,
  attacker: Unit,
  from: Coordinate,
  targetUnitId: string,
): string | null {
  const target = getUnit(state, targetUnitId);
  if (!target) return 'target not found';
  if (target.id === attacker.id) return 'a unit cannot attack itself';
  if (target.owner === attacker.owner) return 'that unit is yours';

  const off = outsideRange(attacker, from, target.position);
  if (off === 'near') return 'target is too close';
  if (off === 'far') return 'target is out of range';
  return null;
}

/**
 * What the server rolls for one resolution.
 *
 * ⚠️ **Named, not a tuple** -- `rolls.attack` says what it is where `rolls[0]`
 * is anonymous, and an *array* would invite `rolls[2]`, which is `undefined`,
 * which is `NaN` damage: silent, and the same shape as a stored unit with no
 * health.
 *
 * ⚠️ **A union, and what decides the member is the *command*, not the rules.**
 * The note on `counter` below says the number of draws must never depend on the
 * rules -- that is why a counter is drawn whether or not it is used. This does
 * not breach it: the server knows the attack kind before it rolls, because the
 * client said so. Reading a command is not running a rule.
 *
 * ⚠️ **A charge draws once.** Its repel damage is derived from how far that same
 * roll overshot the chance, so there is no second draw to make -- which is what
 * decided the shape of this union after 10a settled the repel formula.
 */
export interface FireRolls {
  attack: number;
  counter: number;
}
export interface ChargeRolls {
  charge: number;
}
export type Rolls = FireRolls | ChargeRolls;

/** ⚠️ Narrowing helper, so no caller writes `'charge' in rolls` by hand. */
export function isChargeRoll(rolls: Rolls): rolls is ChargeRolls {
  return 'charge' in rolls;
}

/**
 * Which side of its range a distance falls off, or null if it is inside.
 *
 * ⚠️ **The one place the band is tested.** It was written twice -- once as
 * `< min || > max` for a refusal reason and once as `>= min && <= max` for the
 * counter predicate -- which is two spellings of one rule, in one file, each the
 * negation of the other. Flipping a bound to exclusive would have needed
 * remembering both, and that is how an off-by-one arrives.
 */
function outsideRange(unit: Unit, from: Coordinate, target: Coordinate): 'near' | 'far' | null {
  const { range } = getUnitType(unit.unitTypeId);
  const distance = tileDistance(from, target);
  if (distance < range.min) return 'near';
  if (distance > range.max) return 'far';
  return null;
}

/**
 * Every tile a unit standing at `from` could shoot at, whether or not anything
 * is there.
 *
 * ⚠️ **Reach, not targets.** The overlay draws this whole band, because a gun's
 * reach is most of what makes it a gun and lighting only occupied tiles would
 * hide it. Red therefore means *in range*, not *attackable*.
 *
 * ⚠️ Here rather than in the client, so the band is stated once. A client
 * looping over tiles with its own `>= min && <= max` would be the third
 * spelling of a rule that already had two.
 */
export function tilesInRange(
  unit: Unit,
  from: Coordinate,
  gridWidth: number,
  gridHeight: number,
): Coordinate[] {
  const { range } = getUnitType(unit.unitTypeId);
  const tiles: Coordinate[] = [];

  // Only the diamond `max` reaches, rather than the whole board: at `max: 5` on
  // a 12x12 that is 60 candidates instead of 144, and it stays proportional to
  // the range rather than to the map.
  for (let dCol = -range.max; dCol <= range.max; dCol++) {
    for (let dRow = -range.max; dRow <= range.max; dRow++) {
      const tile = { col: from.col + dCol, row: from.row + dRow };
      if (!isWithinGrid(tile, gridWidth, gridHeight)) continue;
      if (outsideRange(unit, from, tile) !== null) continue;
      tiles.push(tile);
    }
  }
  return tiles;
}

/**
 * Can `defender` answer an attack that came from `from`?
 *
 * ⚠️ **One predicate, and no categories.** AW's rule reads "both units must be
 * direct", which *looks* categorical and is not: it is equivalent to *the
 * attacker is adjacent and the defender can fight at adjacency*, because a
 * direct unit in AW can only ever attack from range 1. Days of Ruin's Anti-Tank
 * settles it -- indirect out to three, **no minimum range**, and it counters.
 * Under the category reading that needs a special case; under this one it falls
 * out.
 *
 * ⚠️ **A shot from directly behind is never answered**, and this is the only
 * place facing changes shooting -- `computeDamage` still cannot see it. The
 * signature did not have to change to say so, because a `Unit` already carries
 * its facing, which is why both callers got the rule for free: this one, and the
 * client's `attackForecast`.
 *
 * ⚠️ **It negates the counter rather than shrinking it, and the panel is why.**
 * The counter's *magnitude* is deliberately absent from the preview, so a
 * counter that was merely reduced would be invisible at the moment of choosing
 * -- the panel would say "they return fire" either way. An absence is already in
 * its vocabulary. A flanking *damage* bonus was refused on its own terms: see
 * the roadmap's facing section.
 *
 * ⚠️ **In a head-on meeting it changes nothing**, which is the point. Deployment
 * points each army at the other, so the armies arrive front-to-front and the
 * rear has to be earned by manoeuvre. And it only ever bites where a counter was
 * possible at all: a gun firing from outside the defender's band is unanswered
 * regardless of which way anyone is looking.
 *
 * ⚠️ **Ours differs from AW's in exactly one case, deliberately: counter-battery.**
 * Two guns within reach of each other answer each other, which AW forbids and
 * history does not. Artillery caught at one tile still cannot answer, because 1
 * is not inside `[2, 5]` -- the property worth keeping survives without a rule
 * naming it.
 *
 * ⚠️ **`hasActed` is not consulted.** That flag stops a unit *acting* twice in
 * its own turn; answering an attack is not acting. A spent unit still counters,
 * which is AW's behaviour and falls out of this being purely geometric.
 *
 * ⚠️ **A charge never asks this.** The counter rule is about *shooting*, and a
 * charge is not shooting -- its repel damage is the defence. Routing a charge
 * through here would make charging artillery free, since `min: 2` means a
 * battery cannot answer at contact, and the one unit cavalry exists to punish
 * would be the only one unable to punish back.
 */
export function wouldCounter(defender: Unit, from: Coordinate): boolean {
  if (defender.health <= 0) return false;
  if (attackSide(defender.facing, defender.position, from) === 'rear') return false;
  return outsideRange(defender, defender.position, from) === null;
}

/**
 * The exchange, as one event.
 *
 * ⚠️ **`attacker` should be the unit as it is *after* moving.** Nothing in the
 * damage of a first strike reads the attacker's position -- only its health, and
 * the defender's terrain -- but a counter-attack reads the *attacker's* terrain,
 * which is the destination's. Passing the moved unit here means 9g inherits the
 * right tile instead of having to retrofit it.
 *
 * ⚠️ **The attacker's blow lands even when the counter kills it.** It struck
 * first, so its damage is already done -- the mirror of a dead defender never
 * answering. Both healths ride in one event, so the ordering is unambiguous once
 * it is said, and this is where it is said.
 *
 * ⚠️ **The counter is `computeDamage` called a second time in the other
 * direction, not a branch inside the first.** If it ever becomes a special case
 * threaded through the attack, that is the smell: an exchange is two strikes,
 * and the second is the first with the arguments swapped and the defender's
 * *reduced* health in hand.
 */
export function resolveBattle(
  state: GameState,
  attacker: Unit,
  defender: Unit,
  rolls: FireRolls,
): BattleResolvedEvent {
  const damage = computeDamage(state, attacker, defender, rolls.attack);
  // The event says what each side *has*, so both must be numbers a rule can
  // read -- `clampHealth` owns both ends of that, rather than this owning one.
  const defenderHealth = clampHealth(defender.health - damage);

  // ⚠️ Answered on the defender's **post-damage** health, which is most of AW's
  // exchange calculus for free: striking first compounds, because a wounded
  // defender both hits softer and keeps less of its terrain cover.
  const survivor: Unit = { ...defender, health: defenderHealth };
  const answered = wouldCounter(survivor, attacker.position);
  const riposte = answered ? computeDamage(state, survivor, attacker, rolls.counter) : 0;

  return {
    type: 'battleResolved',
    kind: 'fire',
    attacker: { unitId: attacker.id, health: clampHealth(attacker.health - riposte) },
    defender: { unitId: defender.id, health: defenderHealth },
    answered,
  };
}

/**
 * Whether this unit can charge at all -- capability is a row in
 * `CHARGE_THRESHOLD`, never a flag on the catalog.
 *
 * ⚠️ **A missing row *is* the rule.** Artillery has none, which says "artillery
 * cannot charge" once. A `canCharge` boolean beside the table would say it
 * twice, and the two could disagree.
 */
export function chargeThreshold(attacker: UnitTypeId, defender: UnitTypeId): number | null {
  return CHARGE_THRESHOLD[attacker]?.[defender] ?? null;
}

/**
 * The odds a charge breaks the target, as a whole percentage.
 *
 * ```
 * margin = max(0, targetHealth + terrainDefense - threshold)
 * chance = max(1, round(100 * 0.5 ^ (margin / CHARGE_HALF_LIFE)))
 * ```
 *
 * ⚠️ **Raw health, deliberately not banded**, and this was measured rather than
 * assumed. Damage bands because raw health broke it -- a unit at 1% dealt zero.
 * Charge has no such failure, and banding costs two things: fully banded, any
 * multiplier under 1.4 vanishes outright, because `band(25)` and `band(28)` are
 * both 3; banding the target but not the threshold makes the table lie, since
 * `ceil` rounds up and a unit sitting exactly on a stated threshold of 25 shows
 * 79%.
 *
 * ⚠️ **Terrain adds to the target's health rather than moving the threshold.**
 * The expression already asks *how far is health above the threshold*, so cover
 * finishes that sentence instead of introducing a second mechanism beside it.
 * Forest costs an attacker 2-7 points, a mountain 4-13, and plains needs no
 * special case: one defence star against a half-life of fifteen is a ~4% relative
 * change that rounds away at most healths.
 *
 * ⚠️ **The 1% floor is stated, not emergent.** Exponential decay never reaches
 * zero mathematically, but integer percentages do, and a silent 0% would
 * contradict the design -- cavalry into a full-health line is a long shot, not a
 * wall. That floor also makes `chance` safe to divide by, which the repel does.
 *
 * ⚠️ **`directionalMultiplier` is pinned at 1 until 10b.** Charge and facing are
 * the two mechanics with no reference behaviour, and two untested dials inside
 * one expression cannot be told apart by any observation.
 */
export function chargeChance(state: GameState, attacker: Unit, defender: Unit): number | null {
  const threshold = chargeThreshold(attacker.unitTypeId, defender.unitTypeId);
  if (threshold === null) return null;

  const { defense } = getTerrain(state.grid[defender.position.row][defender.position.col]);
  const margin = Math.max(0, defender.health + defense - threshold);
  return Math.max(1, Math.round(100 * 0.5 ** (margin / CHARGE_HALF_LIFE)));
}

/**
 * Why this charge is refused, or `null` if it is legal.
 *
 * ⚠️ **Contact, not a range band.** `refuseAttack` measures the attacker's
 * `range`, and infantry reaches two -- so reusing it would permit a "charge"
 * from two tiles off. Cavalry's `{1,1}` coincides with contact only by accident.
 *
 * ⚠️ **And the attacker must be able to *stand* where the target is**, since a
 * successful charge displaces onto that tile. That is a question about terrain
 * alone: `entryCost` answers it, and also refuses the tile for being enemy-held
 * -- which is exactly the tile being charged -- so the terrain half is asked
 * through `terrainAdmits` instead, which both share.
 */
export function refuseCharge(
  state: GameState,
  attacker: Unit,
  from: Coordinate,
  targetUnitId: string,
): string | null {
  const target = getUnit(state, targetUnitId);
  if (!target) return 'target not found';
  if (target.id === attacker.id) return 'a unit cannot charge itself';
  if (target.owner === attacker.owner) return 'that unit is yours';
  if (chargeThreshold(attacker.unitTypeId, target.unitTypeId) === null) {
    return `${attacker.unitTypeId} cannot charge`;
  }
  if (tileDistance(from, target.position) !== 1) return 'a charge has to reach them';

  const { movementType } = getUnitType(attacker.unitTypeId);
  const tile = getTileAt(state, target.position);
  if (!tile || !terrainAdmits(tile, movementType)) {
    return `${movementType} cannot cross ${tile ?? 'that'}`;
  }
  return null;
}

/**
 * One charge, resolved.
 *
 * ⚠️ **Success is expressed as damage to zero, not as "it dies"**, which is what
 * lets a charge be an ordinary `battleResolved` with no special case in the
 * reducer -- the same `health <= 0` filter removes it.
 *
 * ⚠️ **A charge never consults the counter rule**, so `answered` means *repelled*
 * here. That rule asks whether the attacker is inside the defender's *range*,
 * which is a question about shooting; applying it would make charging artillery
 * free, since `min: 2` means a battery cannot answer at contact -- the one unit
 * cavalry exists to punish would be the only one unable to punish back. The
 * repel **is** the defence, and every defender has one.
 *
 * ⚠️ **The repel is flat plus a small term from the overshoot**, the same shape
 * `computeDamage` uses for luck. A roll just over `chance` is a near miss and
 * costs the base; a wild charge leaves a wider window to fail into, so its
 * expected overshoot is larger. One term, both behaviours.
 */
export function resolveCharge(
  state: GameState,
  attacker: Unit,
  defender: Unit,
  rolls: ChargeRolls,
): BattleResolvedEvent {
  const chance = chargeChance(state, attacker, defender);
  // Validation proved the attacker has a row, so this is a broken pipeline
  // rather than a bad request -- loud, for the same reason `getUnitType` throws.
  if (chance === null) {
    throw new Error(`resolved a charge for ${attacker.unitTypeId}, which cannot charge`);
  }

  const broke = rolls.charge < chance;
  const repel = broke
    ? 0
    : CHARGE_REPEL[defender.unitTypeId] + Math.floor((rolls.charge - chance) / REPEL_DIVISOR);

  return {
    type: 'battleResolved',
    kind: 'charge',
    attacker: { unitId: attacker.id, health: clampHealth(attacker.health - repel) },
    defender: { unitId: defender.id, health: broke ? 0 : defender.health },
    answered: !broke,
  };
}
