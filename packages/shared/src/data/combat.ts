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
 * ⚠️ **Untuned.** `infantry → infantry` is AW's literal 55 and is the anchor the
 * rest were judged against; everything else is a position to argue with, not an
 * answer. Nothing here has been played. `scripts/matchups.ts` prints what they
 * mean in hits-to-kill, which is the artefact worth tuning against.
 *
 * ⚠️ **Cavalry is mediocre in every column on purpose** -- carbines from
 * horseback. Its identity lives in the charge table (10a), and a cavalry that
 * also shoots well has no reason to close. In particular it *loses* the shooting
 * exchange with artillery, 55 out against 75 back, which is what forces the
 * charge to be its answer rather than one of two.
 */
export const BASE_DAMAGE: Record<UnitTypeId, Record<UnitTypeId, number>> = {
  infantry: { infantry: 55, cavalry: 60, artillery: 70 },
  cavalry: { infantry: 40, cavalry: 45, artillery: 55 },
  artillery: { infantry: 90, cavalry: 75, artillery: 60 },
};

/**
 * The widest the luck bonus ever gets, matching AW exactly.
 *
 * ⚠️ **Additive, never multiplicative**, which is what makes weak attacks the
 * swingy ones: 9 points on a base of 40 is up to +22%, the same 9 on a base of
 * 90 is +10%. That asymmetry is a design property worth keeping, not an
 * artefact.
 *
 * ⚠️ **Never negative.** Base AW luck is a bonus only -- "bad luck" belongs to
 * particular COs -- so a table value is a *floor* on what an attack does, not
 * an average it varies around.
 *
 * No rescaling was needed from AW: the 0-9 is already in our units, because
 * `baseDamage` is a percentage in both schemes.
 */
export const LUCK_MAX = 9;
