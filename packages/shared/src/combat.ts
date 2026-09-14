import { BASE_DAMAGE } from './data/combat';
import { getTerrain } from './data/terrain';
import type { GameState, Unit } from './types';

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
 * damage = floor((base + luck) × attackerBand/10) × (100 − stars×defenderBand)/100
 * ```
 *
 * ⚠️ **Both HP terms read the band, never the raw value.** One rule rather than
 * two: it is what keeps a wounded attacker able to fight at all, and applying it
 * to only one side would be half of AW's formula with no principle saying which
 * half. `baseDamage` itself needs no rescaling, because it is a percentage of a
 * full target in both schemes -- which is what lets AW's matchup numbers
 * transfer unchanged.
 *
 * ⚠️ **Luck needs no narrowing code.** It is added to the base *before* the
 * health multiplier, so a weaker attacker's luck is scaled down with everything
 * else: the 0-9 spread at full health becomes 0-4 at half and 0-1 at a sliver,
 * with the floor of 1 falling out of the band never reaching zero. An earlier
 * draft computed the narrowing explicitly and was reimplementing the
 * multiplication it sat next to.
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
 */
export function computeDamage(
  state: GameState,
  attacker: Unit,
  defender: Unit,
  roll: number,
): number {
  const power = BASE_DAMAGE[attacker.unitTypeId][defender.unitTypeId] + roll;

  const { defense } = getTerrain(state.grid[defender.position.row][defender.position.col]);
  // Cover is worth less the less there is left to cover.
  const cover = defense * band(defender.health);

  // ⚠️ Floored in sequence rather than folded: `floor(a × b × c)` and
  // `floor(floor(a × b) × c)` are different numbers, and the second is AW's.
  const scaled = Math.floor((power * band(attacker.health)) / BANDS);
  return Math.max(0, Math.floor((scaled * (100 - cover)) / 100));
}
