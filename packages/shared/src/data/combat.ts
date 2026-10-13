import type { UnitTypeId } from './unitTypes';

/**
 * What each attacker does to each defender, as a percentage of a **full-health**
 * target. Attacker down the side.
 *
 * ⚠️ **There is no attack stat and no defence stat**, following AW, which has
 * neither: a unit's toughness is not a property of the unit, it is every
 * attacker's column against it. Defence comes from terrain and nowhere else.
 *
 * ⚠️ **A matrix is not a stylistic choice here, it is arithmetic.** Give every
 * unit an attack `A` and a defence `D` and let damage be any `f(A, D)`, and the
 * ordering that falls out is *transitive*: if infantry beats cavalry and cavalry
 * beats artillery, then infantry beats artillery, necessarily. Rock-paper-
 * scissors is non-transitive, so no pair of scalars can express one. The only
 * options are a matrix or a class system, and at three unit types a class system
 * is more machinery than the nine numbers it would save.
 *
 * Nested `Record`s, so adding a `UnitTypeId` turns every incomplete row into a
 * compile error rather than a silent gap -- the property `TERRAIN` and
 * `UNIT_TYPES` already have.
 *
 * ⚠️ **Untuned, but no longer arbitrary.** A first cut ran 40-90 and
 * `scripts/matchups.ts` killed it: everything died in two hits, so terrain
 * became a rounding error, the nine numbers produced two distinct outcomes, and
 * luck moved nothing. It also starved 10a -- a unit went 100 to 45 to dead
 * without ever passing through the health band where a charge is legal.
 *
 * The spread here is taken from AW, whose nine analogous cells (Infantry,
 * Recon, Artillery) run 12 to 90. ⚠️ **The range transfers; the shape must
 * not.** AW's 12 and 15 encode *armour penetration* -- a rifle cannot hurt a
 * vehicle -- and there is no armour in a horse-and-musket war. Importing them
 * would say infantry cannot hurt horses and leave cavalry untouchable.
 *
 * ⚠️ **Cavalry fights with sabres, and hits hardest at close quarters.** It
 * pays in reach and reply instead: one tile, and as a `melee` unit it cannot
 * answer a ranged attacker.
 *
 * ⚠️ **Artillery's row is kept below what its range would suggest**, because
 * nothing answers a gun: it fires from beyond every reply and `slow` means it
 * never counters, so its damage is pure profit.
 *
 * ⚠️ The two sides of an exchange use one formula, so there is no dial for
 * "counters hit softer" and there should not be: the whole asymmetry is that a
 * counter is computed on the defender's **post-damage** health, the same as
 * Advance Wars. Hit harder and the defender loses more bands before answering,
 * so the counter shrinks while the attack grows.
 *
 * ⚠️ **Not pushed toward AW's steeper first strikes**, because it costs two
 * other mechanics: terrain stops changing hit counts, and units stop lingering
 * at the health where a charge can finish them.
 *
 * ⚠️ **A charge reads it too**, at an attack's worst roll times the side it
 * arrives on -- see `chargeDamage`. Raising an entry raises what a charge
 * finishes, and `charge.test.ts` holds every rear charge short of a full-health
 * target.
 */
export const BASE_DAMAGE: Record<UnitTypeId, Record<UnitTypeId, number>> = {
  infantry: { infantry: 45, cavalry: 35, artillery: 45 },
  cavalry: { infantry: 55, cavalry: 45, artillery: 65 },
  artillery: { infantry: 55, cavalry: 45, artillery: 45 },
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
 * mountain rounds to zero and the *no living attacker is harmless* sweep in
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
 * on, as a percentage: an attack's worst roll head-on, a quarter more on the
 * flank and half again from the rear. Getting round a unit is what a charge is
 * for.
 *
 * ⚠️ **On the final damage**, so a charge is `computeDamage` at roll 0 with
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
 * The attacks it takes to earn a charge. Every attack a unit that can charge
 * makes fills its meter a point, up to this; a charge needs it full and spends
 * all of it. Answering an attack fills nothing, and nothing but a charge or the
 * unit's death empties it.
 */
export const CHARGE_METER_FULL = 3;
