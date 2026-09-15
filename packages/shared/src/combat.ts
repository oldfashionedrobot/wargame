import { tileDistance } from './coordinate';
import { BASE_DAMAGE } from './data/combat';
import { clampHealth, getUnitType } from './data/unitTypes';
import { getUnit } from './queries';
import { getTerrain } from './data/terrain';
import type { BattleResolvedEvent, Coordinate, GameState, Unit } from './types';

/** How many ten-point bands of health a unit has left: 1 through 10, never 0. */
const BANDS = 10;

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
 */
function band(health: number): number {
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

  const { range } = getUnitType(attacker.unitTypeId);
  const distance = tileDistance(from, target.position);
  if (distance < range.min) return 'target is too close';
  if (distance > range.max) return 'target is out of range';
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
 * ⚠️ **Two, because two is the maximum anything needs.** A volley draws once or
 * twice; a charge never has a counter, because it does not consult the counter
 * rule at all. ⚠️ **Not a discriminated union yet**: the charge member cannot be
 * written correctly until 10a says whether a failed charge's repel damage is
 * rolled. `{ charge }` or `{ charge, repel }` is an open question, and putting
 * either in a type now would make it look answered.
 *
 * ⚠️ `counter` is drawn whether or not it is used. Deciding first and rolling
 * second would make the *number of draws* depend on the rules, which is exactly
 * the coupling keeping randomness on the server side is meant to avoid.
 */
export interface Rolls {
  attack: number;
  counter: number;
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
  const { range } = getUnitType(defender.unitTypeId);
  const distance = tileDistance(from, defender.position);
  return distance >= range.min && distance <= range.max;
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
  rolls: Rolls,
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
    kind: 'volley',
    attacker: { unitId: attacker.id, health: clampHealth(attacker.health - riposte) },
    defender: { unitId: defender.id, health: defenderHealth },
    answered,
  };
}
