import type { UnitTypeId } from './unitTypes';

/**
 * What each attacker does to each defender, as a percentage of a **full-health**
 * target. Attacker down the side.
 *
 * ⚠️ **A charge reads it too**, at an attack's best roll times the side it
 * arrives on -- see `chargeDamage` -- so raising an entry raises what a charge
 * finishes. Cavalry into a gun's rear on open ground finishes it at any health:
 * accepted, as what getting behind a battery with a full meter is worth.
 */
export const BASE_DAMAGE: Record<UnitTypeId, Record<UnitTypeId, number>> = {
  infantry: { infantry: 45, cavalry: 35, artillery: 45, general: 35 },
  cavalry: { infantry: 55, cavalry: 45, artillery: 65, general: 45 },
  artillery: { infantry: 55, cavalry: 45, artillery: 45, general: 45 },
  // The general fights, and is fought, as cavalry -- for now.
  general: { infantry: 55, cavalry: 45, artillery: 65, general: 45 },
};

/**
 * What a star of cover is multiplied by before it is taken off a hit: 15% at
 * full defender health rather than the 10% the raw column reads as.
 *
 * ⚠️ **It exists because a star was below the resolution of the system.** Hits
 * to kill is an integer, so most single-star changes moved nothing at all: at
 * 10% the step from 1 star to 2 moved **0 cells of 9**, and 3 to 4 moved 1. At
 * 15% the same steps move 5 and 6. Weighting the term and emptying the 1-star
 * slot are two halves of one change -- either alone leaves cover decorative.
 *
 * ⚠️ **The invariant is `maxStars × TERRAIN_WEIGHT < 10`**, which is what keeps
 * `computeDamage` from needing a clamp. At 1.5 that caps terrain at **6 stars**;
 * the table's stoutest ground is 4. Past the line, cover exceeds 100% and
 * terrain starts healing the unit standing on it.
 *
 * ⚠️ **And a second, softer ceiling at 1.667**, where the weakest matchup on a
 * hills rounds to zero and the *no living attacker is harmless* sweep in
 * `combat.test.ts` fires -- so this constant and the table's lowest entry move
 * together downward, though never upward.
 */
export const TERRAIN_WEIGHT = 1.5;

/**
 * The widest the luck bonus ever gets: AW's standard range, from AW1 through
 * Dual Strike. Days of Ruin widened it to 0-10.
 *
 * ⚠️ **Added to the base before anything scales it**, as AW does -- see
 * `computeDamage`. So the full width belongs to a full-strength unit firing into
 * the open: an attacker on half its health has about half the range, one on its
 * last band has next to none, and cover trims luck along with the rest.
 *
 * ⚠️ **Never negative.** Base AW luck is a bonus only -- "bad luck" belongs to
 * particular COs -- so a table value is a *floor* on what an attack does, not
 * an average it varies around.
 *
 * No rescaling was needed from AW: the 0-9 is already in our units, because
 * `baseDamage` is a percentage in both schemes.
 */
export const LUCK_MAX = 9;

/**
 * What a charge's damage is multiplied by for the side of the target it arrives
 * on, as a percentage: an attack's best roll head-on, a quarter more on the
 * flank and half again from the rear. Getting round a unit is what a charge is
 * for.
 *
 * ⚠️ **On the final damage**, so a charge is `computeDamage` at `LUCK_MAX` with
 * nothing changed inside it -- see `chargeDamage`.
 *
 * ⚠️ **Multiplied, never added**, so `BASE_DAMAGE` can be retuned without
 * dragging these behind it.
 */
export const CHARGE_FACING: Record<'front' | 'flank' | 'rear', number> = {
  front: 100,
  flank: 125,
  rear: 150,
};

/**
 * A full-strength charger's chance of breaking a full-health target head-on, as
 * a percentage. The flank and rear scale it by `CHARGE_FACING`, and the
 * charger's own health scales the lot -- see `chargeChance`, which runs a
 * charge's odds from certain at its kill line down to this at full health.
 */
export const CHARGE_CHANCE_AT_FULL = 25;
