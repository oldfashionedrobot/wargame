import { attackSide, isWithinGrid, tileDistance } from './coordinate';
import { terrainAdmits } from './movement';
import {
  BASE_DAMAGE,
  TERRAIN_WEIGHT,
  CHARGE_HALF_LIFE,
  FLOOR_PER_STAR,
  FRONTAL_FLOOR,
  CHARGE_REPEL,
  CHARGE_THRESHOLD,
  FLANK_MULTIPLIER,
  REAR_MULTIPLIER,
  REPEL_DIVISOR_FRESH,
  REPEL_DIVISOR_SPENT,
} from './data/combat';
import { clampHealth, getUnitType } from './data/unitTypes';
import type { UnitTypeId } from './data/unitTypes';
import { defenseAt, getTileAt, getUnit, inContact } from './queries';
import type { BattleResolvedEvent, Coordinate, GameState, Unit } from './types';

/** How many ten-point bands of health a unit has left: 1 through 10, never 0. */
export const BANDS = 10;

/**
 * The health term the formula reads: AW's displayed 1-10, `ceil(health / 10)`.
 *
 * ⚠️ **This is the whole reason a living unit can still fight.** Health is
 * stored and shown as 0-100 here -- displaying 1-10 was a GBA screen
 * constraint rather than a rule worth keeping -- but the
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
 * damage = floor(floor((base + luck) × attackerBand/10) × (100 − stars×defenderBand)/100)
 * ```
 *
 * ⚠️ **Both HP terms read the band, never the raw value.** One rule rather than
 * two: it is what keeps a wounded attacker able to fight at all, and applying it
 * to only one side would be half of AW's formula with no principle saying which
 * half. `baseDamage` itself needs no rescaling, because it is a percentage of a
 * full target in both schemes -- which is what lets AW's matchup numbers
 * transfer unchanged.
 *
 * ⚠️ **Luck joins the base before anything scales it**, which is Advance Wars'
 * order in every game in the series: luck is added to the attack value, and
 * that is then multiplied by the attacker's band and cut by the defender's
 * cover. So **a wounded unit's luck shrinks with it** -- one on its last band
 * cannot luck its way into an extra tenth -- and cover takes its share of luck
 * the way it takes its share of everything else. The full band of luck belongs
 * to a full-strength unit firing into the open.
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
 * **Where this comes from.** AW's own formula, its luck behaviour, and its
 * truncation points are documented across these:
 *
 * - https://advancewars.fandom.com/wiki/Damage_Formula -- the formula per game,
 *   AW1 through Days of Ruin, each adding luck before the HP multiply.
 * - https://awbw.fandom.com/wiki/Damage_Formula -- the formula in AW's own units
 *   (HP 1-10), which is what the rescale note above is about.
 * - https://www.warsworldnews.com/wp/aw/game-aw/battle-mechanics/ -- terrain
 *   stars and the exchange model.
 * - https://advancewars.fandom.com/wiki/Luck -- luck added before the HP
 *   multiply, and the range shrinking by a point for every HP lost.
 * - https://awbw.fandom.com/wiki/Terrain -- the terrain stars these are scaled
 *   against.
 * - https://advancewars.fandom.com/wiki/Indirect_Combat -- minimum range, and
 *   why an indirect unit is not answered at all.
 * - https://warswiki.org/wiki/Damage/Advance_Wars_2_chart -- the base damage
 *   matrix the spread of `BASE_DAMAGE` was taken from.
 */
export function computeDamage(
  state: GameState,
  attacker: Unit,
  defender: Unit,
  roll: number,
): number {
  const base = BASE_DAMAGE[attacker.unitTypeId][defender.unitTypeId];

  const defense = defenseAt(state, defender.position);
  // Cover is worth less the less there is left to cover, and a star is worth
  // more than it reads -- see `TERRAIN_WEIGHT`.
  //
  // ⚠️ **No clamp is needed, and what guarantees that is now two constants
  // rather than one column.** The bound is `maxStars × TERRAIN_WEIGHT < 10`:
  // at 4 stars and 1.5 the worst case is 60 against 10 bands, so the factor
  // below cannot go negative and terrain cannot heal anyone. Raise either past
  // the line and it can. ⚠️ An odd star count leaves `cover` on a half-point,
  // which the final floor absorbs; nothing here needs to round it.
  const cover = defense * band(defender.health) * TERRAIN_WEIGHT;

  // ⚠️ **Luck goes in with the base**, so the attacker's band and the
  // defender's cover scale it like the rest -- AW's order. That also makes a
  // dead attacker harmless with no guard of its own: `band(0)` is 0, and zeroes
  // the luck along with everything else.
  //
  // ⚠️ Floored in sequence rather than folded: `floor(a × b × c)` and
  // `floor(floor(a × b) × c)` are different numbers, and the second is AW's.
  const scaled = Math.floor(((base + roll) * band(attacker.health)) / BANDS);
  return Math.floor((scaled * (100 - cover)) / 100);
}

/**
 * Why a unit may not attack at all from the route it took, or `null`.
 *
 * ⚠️ **The one place the *turn* rule lives**, asked by both attacks and by both
 * sides of the wire: `validateMove` refuses the command with it, and the panel
 * asks it before offering a row. A rule about a turn cannot be derived from a
 * distance, so it cannot live in `outsideRange` with the rest.
 *
 * ⚠️ **Two causes, one consequence: move or attack, not both.** A `slow` unit
 * is always under it. Any other unit is under it when it *starts* in contact --
 * asked of the path's first tile, because where a unit ended up does not say
 * where it began. A unit that starts in the open moves and attacks as it always
 * has, including moving *into* contact and attacking on arrival.
 *
 * ⚠️ **Turning is not moving.** A single-element path is a turn in place, so a
 * gun may pivot onto a target and fire, and a unit in contact may turn to face
 * whoever it is fighting and strike.
 */
function refuseMovingAttack(state: GameState, attacker: Unit, path: Coordinate[]): string | null {
  if (path.length <= 1) return null;
  if (getUnitType(attacker.unitTypeId).slow) {
    return `${attacker.unitTypeId} cannot move and attack in one turn`;
  }
  if (inContact(state, attacker, path[0])) {
    return 'a unit that starts in contact can move or attack, not both';
  }
  return null;
}

/**
 * The checks every attack opens with, shot or charge: the target exists, is an
 * enemy -- which also refuses a unit itself -- and the turn allows attacking.
 * Returns the target, or why not.
 */
function refuseTarget(
  state: GameState,
  attacker: Unit,
  path: Coordinate[],
  targetUnitId: string,
): Unit | string {
  const target = getUnit(state, targetUnitId);
  if (!target) return 'target not found';
  if (target.owner === attacker.owner) return 'that unit is yours';
  return refuseMovingAttack(state, attacker, path) ?? target;
}

export function refuseAttack(
  state: GameState,
  attacker: Unit,
  path: Coordinate[],
  targetUnitId: string,
): string | null {
  const target = refuseTarget(state, attacker, path, targetUnitId);
  if (typeof target === 'string') return target;

  const off = outsideRange(attacker, path[path.length - 1], target.position);
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
 * ⚠️ **The rear negates the counter, and nothing else about facing touches a
 * shot.** Front and flank both draw a full reply, so what the panel says --
 * "they return fire" or nothing -- is the whole of the rule rather than a
 * rounding of it. A flanking *damage* bonus on the attacking shot is a different
 * thing and was refused on its own terms.
 *
 * ⚠️ **In a head-on meeting it changes nothing**, which is the point. Deployment
 * points each army at the other, so the armies arrive front-to-front and the
 * rear has to be earned by manoeuvre. And it only ever bites where a counter was
 * possible at all: a gun firing from outside the defender's band is unanswered
 * regardless of which way anyone is looking.
 *
 * ⚠️ **Counter-battery is gone, and `slow` took it.** Two guns within reach of
 * each other used to answer each other -- a deliberate divergence from AW, on
 * the grounds that history allows it. Play disagreed. The flag reads first, so
 * the band's *too close* case is now unreachable from here: artillery is the
 * only unit with `min > 1` and it is slow. `refuseAttack` still asks both ends.
 *
 * ⚠️ **`hasActed` is not consulted.** That flag stops a unit *acting* twice in
 * its own turn; answering an attack is not acting. A spent unit still counters,
 * which is AW's behaviour -- nothing here asks what the defender has *done*,
 * only what it is and where it stands.
 *
 * ⚠️ **A charge never asks this.** The counter rule is about *shooting*, and a
 * charge is not shooting -- its repel damage is the defence. Routing a charge
 * through here would make charging artillery free, and more plainly so than it
 * once would: a battery now answers nothing at all, so the one unit cavalry
 * exists to punish would be the only one unable to punish back.
 */
export function wouldCounter(defender: Unit, from: Coordinate): boolean {
  if (defender.health <= 0) return false;
  // ⚠️ A gun that has to be traversed cannot be swung round in time -- see
  // `slow`. This subsumes what the range band already did at contact and goes
  // further, taking counter-battery with it.
  if (getUnitType(defender.unitTypeId).slow) return false;
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
  // ⚠️ **Front and flank answer in full; only the rear is refused**, and
  // `wouldCounter` has already done that.
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
 * ⚠️ **Raw health, deliberately not banded**, and this was measured rather than
 * assumed. Damage bands because raw health broke it -- a unit at 1% dealt zero.
 * Charge has no such failure, and banding costs two things: fully banded, any
 * multiplier under 1.4 vanishes outright, because `band(25)` and `band(28)` are
 * both 3; banding the target but not the threshold makes the table lie, since
 * `ceil` rounds up and a unit sitting exactly on a stated threshold of 25 shows
 * 71%.
 *
 * ⚠️ **The 1% floor is stated, not emergent**: rounding would otherwise make a
 * long enough shot impossible rather than improbable.
 *
 * ⚠️ **The directional term shipped separately from the rest of this**, and the
 * reason is worth keeping: charge and facing were the two mechanics with no
 * reference behaviour, and two untested dials inside one expression cannot be
 * told apart by any observation. Head-on was tuned first, against a formula with
 * one unknown in it.
 */
export function chargeChance(state: GameState, attacker: Unit, defender: Unit): number | null {
  const threshold = chargeThreshold(attacker.unitTypeId, defender.unitTypeId);
  if (threshold === null) return null;

  // ⚠️ **Read from where the attacker will be standing**, which is what the
  // callers already hand over: `resolveMove` builds the moved unit, and the
  // client's forecast builds the same one. Facing read against the *origin*
  // would price a charge by where the ride started.
  const side = attackSide(defender.facing, defender.position, attacker.position);
  const directional = side === 'rear' ? REAR_MULTIPLIER : side === 'flank' ? FLANK_MULTIPLIER : 1;

  // ⚠️ **Terrain and a braced front set a floor under the margin; they do not
  // add to it.** A floor is a ceiling on the odds -- see `FRONTAL_FLOOR` -- so
  // both come to matter exactly where a charge was about to become a sure
  // thing, and stop mattering to one that was hopeless anyway. 100% now needs
  // position *and* open ground.
  const defense = defenseAt(state, defender.position);
  const marginFloor = (side === 'front' ? FRONTAL_FLOOR : 0) + defense * FLOOR_PER_STAR;
  const margin = Math.max(marginFloor, defender.health - Math.floor(threshold * directional));
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
  path: Coordinate[],
  targetUnitId: string,
): string | null {
  const target = refuseTarget(state, attacker, path, targetUnitId);
  if (typeof target === 'string') return target;
  if (chargeThreshold(attacker.unitTypeId, target.unitTypeId) === null) {
    return `${attacker.unitTypeId} cannot charge`;
  }
  if (tileDistance(path[path.length - 1], target.position) !== 1) {
    return 'a charge has to reach them';
  }

  const { movementType } = getUnitType(attacker.unitTypeId);
  const tile = getTileAt(state, target.position);
  if (!tile || !terrainAdmits(tile, movementType)) {
    return `${movementType} cannot cross ${tile ?? 'that'}`;
  }
  return null;
}

/**
 * What a failed charge costs the attacker, for the roll that failed it: the
 * base, plus how far the roll missed divided by a divisor that falls from
 * `REPEL_DIVISOR_SPENT` to `REPEL_DIVISOR_FRESH` as the defender's band rises.
 *
 * ⚠️ `miss / divisor` is worked as `miss × steps / denominator`, the same ratio
 * in whole numbers, so no band floors a point short.
 */
export function repelDamage(defender: Unit, chance: number, roll: number): number {
  const steps = BANDS - 1;
  const denominator =
    REPEL_DIVISOR_SPENT * steps -
    (REPEL_DIVISOR_SPENT - REPEL_DIVISOR_FRESH) * (band(defender.health) - 1);
  return CHARGE_REPEL[defender.unitTypeId] + Math.floor(((roll - chance) * steps) / denominator);
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
 * free: a battery answers nothing at all now, so the one unit cavalry exists to
 * punish would be the only one unable to punish back. The
 * repel **is** the defence, and every defender has one.
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
  const repel = broke ? 0 : repelDamage(defender, chance, rolls.charge);

  return {
    type: 'battleResolved',
    kind: 'charge',
    attacker: { unitId: attacker.id, health: clampHealth(attacker.health - repel) },
    defender: { unitId: defender.id, health: broke ? 0 : defender.health },
    answered: !broke,
  };
}
