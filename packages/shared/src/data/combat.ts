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
 * The most health a **full-strength** charger executes from the target's
 * **flank** on open ground, attacker down the side. A percentage, read against
 * the defender's raw health.
 *
 * ⚠️ **A charge is a sure execute, so this is a line rather than odds.** At or
 * under what `chargeReach` makes of it, a charge is offered and kills; over it,
 * a charge is not offered at all. The side it arrives on, the target's cover
 * and the charger's own health each scale it -- see `CHARGE_FACING`,
 * `CHARGE_COVER_PER_STAR` and `chargeReach`.
 *
 * ⚠️ **`Partial`, and the missing row is the rule.** Artillery has none, which is
 * how "artillery cannot charge" is said -- rather than a `canCharge` flag on the
 * unit catalog saying the same thing a second time, where the two could drift.
 * A unit with no row has no charge meter either. Any unit can still be a
 * *target*.
 *
 * ⚠️ **Raw health, deliberately not banded.** Damage bands because raw health
 * broke it -- a unit at 1% dealt zero. A charge has no such failure, and banding
 * would make the table lie: `ceil` rounds up, so a unit sitting exactly on a
 * stated line would read as the band above it.
 *
 * ⚠️ **The triangle closes here, not in `BASE_DAMAGE`.** A gun reaches cavalry
 * from three to five tiles and cavalry reaches a gun only from one, so cavalry
 * spends its approach under fire whatever it means to do on arrival -- and
 * `cavalry → artillery` is what makes arriving pay. ⚠️ Argued from *range*
 * rather than from the two damage figures, which are the part that gets tuned.
 * Head-on halves every entry, so a frontal charge into infantry needs a
 * nearly-dead target -- which is what "infantry beats cavalry by not breaking"
 * has to mean numerically.
 *
 * ⚠️ **The hard constraint is that no entry reaches `MAX_HEALTH` from the
 * rear.** Past it a rear charge executes a *full-health* unit, which is a dead
 * dial rather than a signature moment. `charge.test.ts` holds every entry to it.
 *
 * ⚠️ `infantry → cavalry 15` is the lowest number in either table on purpose.
 * Charging cavalry on foot should almost never be the right call, and a number
 * says so more cheaply than a rule forbidding it.
 *
 * ⚠️ **First numbers, to be tried in play.** `scripts/charges.ts` prints what
 * each entry executes on every side, depth of cover and charger health, which
 * is the artefact to argue with.
 */
export const CHARGE_THRESHOLD: Partial<Record<UnitTypeId, Record<UnitTypeId, number>>> = {
  cavalry: { infantry: 35, cavalry: 25, artillery: 45 },
  infantry: { infantry: 25, cavalry: 15, artillery: 35 },
};

/**
 * How much of the threshold a charge reaches by the side of the target it
 * arrives on, as a percentage: head-on halves it, the flank is the threshold
 * itself, and the rear adds half again. Charging head-on always gives the
 * defender a better chance.
 *
 * ⚠️ **Multiplied, never added, and the reason is retuning.** An additive
 * constant stops meaning anything the moment the table underneath it moves --
 * halve every threshold and a flat `+20` goes from a nudge to an override. A
 * multiplier is scale-free, so `CHARGE_THRESHOLD` can be retuned without
 * dragging these behind it.
 *
 * ⚠️ **Whole percentages**, so `chargeReach` can work in integers.
 */
export const CHARGE_FACING: Record<'front' | 'flank' | 'rear', number> = {
  front: 50,
  flank: 100,
  rear: 150,
};

/**
 * What each star of the target's cover takes off a charge's reach, as a
 * percentage of it: a wood's two stars take 20%, a mountain's four 40%. A
 * worn-down unit that falls back into a wood or onto a hill is genuinely harder
 * to finish.
 *
 * ⚠️ **A share, not the damage formula's cover.** That cover shrinks with the
 * defender's health, so against the worn-down units an execute reaches it takes
 * almost nothing -- 6% on a mountain at 10 health, against 40% here. A share
 * scales with the threshold, so every charge stays possible and only gets
 * harder, where a flat amount per star would eat the small thresholds whole.
 *
 * ⚠️ **Held under 100% at the deepest cover** by `charge.test.ts`, or a charge
 * into it would reach below nothing.
 */
export const CHARGE_COVER_PER_STAR = 10;

/**
 * The attacks it takes to earn a charge. Every attack a unit that can charge
 * makes fills its meter a point, up to this; a charge needs it full and spends
 * all of it. Answering an attack fills nothing, and nothing but a charge or the
 * unit's death empties it.
 */
export const CHARGE_METER_FULL = 3;
