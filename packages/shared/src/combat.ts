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
