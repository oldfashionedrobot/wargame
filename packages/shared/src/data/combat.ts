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
 * ⚠️ **Cavalry is bad in every column on purpose** -- carbines from horseback.
 * Its identity lives in the charge table, and a cavalry that also shoots well
 * has no reason to close. Four hits to kill infantry is what makes that true
 * rather than merely stated.
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
 * at the health where a charge is a good bet.
 */
export const BASE_DAMAGE: Record<UnitTypeId, Record<UnitTypeId, number>> = {
  infantry: { infantry: 45, cavalry: 50, artillery: 60 },
  cavalry: { infantry: 30, cavalry: 35, artillery: 40 },
  artillery: { infantry: 55, cavalry: 40, artillery: 40 },
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
 * ⚠️ **And a second, softer ceiling at 1.667**, where `cavalry → infantry` on a
 * mountain rounds to zero and the *no living attacker is harmless* sweep in
 * `combat.test.ts` fires. That guard is one point of base damage away from
 * binding either way, so this constant and `BASE_DAMAGE` have to move together
 * downward, though never upward.
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
 * Target health at or below which a charge reaches its **ceiling**, attacker
 * down the side. A percentage, read against the defender's raw health.
 *
 * ⚠️ **It used to mean *certain*, and the floor took that away.** A head-on
 * charge caps at 87% on open ground, so this is the health at which being any
 * weaker stops helping -- not the health at which the charge cannot fail. From
 * the flank or rear on open ground there is no frontal floor and it does still
 * mean certain.
 *
 * ⚠️ **`Partial`, and the missing row is the rule.** Artillery has none, which is
 * how "artillery cannot charge" is said -- rather than a `canCharge` flag on the
 * unit catalog saying the same thing a second time, where the two could drift.
 * Any unit can still be a *target*.
 *
 * ⚠️ **The triangle closes here, not in `BASE_DAMAGE`.** A gun reaches cavalry
 * from three to five tiles and cavalry reaches a gun only from one, so cavalry
 * spends its approach under fire whatever it means to do on arrival -- and
 * `cavalry → artillery` is what makes arriving pay. ⚠️ Argued from *range*
 * rather than from the two damage figures, which are the part that gets tuned. Against infantry
 * it is 25: a frontal charge needs a nearly-dead target, which is what
 * "infantry beats cavalry by not breaking" has to mean numerically.
 *
 * ⚠️ **The hard constraint is `threshold × REAR_MULTIPLIER < MAX_HEALTH`.**
 * Past it, doubling carries the threshold beyond the health ceiling, the margin
 * can never be positive, and a rear charge is automatically certain against a
 * *full-health* defender -- a dead dial rather than a signature moment. At
 * `REAR_MULTIPLIER` 2 that means every entry under 50. The artillery column was
 * the only one near the line, and came down to clear it.
 *
 * ⚠️ **The constraint only guards the full-health case, and a band survives on
 * the flank.** `floor(45 × 1.5)` is 67, so a flank charge on a battery is still
 * automatic at 67 health and below in the open -- down from 85, and accepted:
 * riding round a gun crew that has been worked that far down *should* decide
 * it. The levers if play disagrees are another cut to the row or
 * `FLANK_MULTIPLIER`.
 *
 * ⚠️ `infantry → cavalry 15` is the lowest number in either table on purpose.
 * Charging cavalry on foot should almost never be the right call, and a number
 * says so more cheaply than a rule forbidding it.
 *
 * ⚠️ **Lightly tuned.** The shape is first-cut and the artillery column has had
 * one pass; the rest is where it started. `scripts/charges.ts` prints all three
 * approaches on every depth of cover, which is the artefact to argue with.
 */
export const CHARGE_THRESHOLD: Partial<Record<UnitTypeId, Record<UnitTypeId, number>>> = {
  cavalry: { infantry: 25, cavalry: 25, artillery: 45 },
  infantry: { infantry: 20, cavalry: 15, artillery: 35 },
};

/**
 * What a **failed** charge costs the attacker, keyed by who was charged.
 *
 * ⚠️ **Keyed by the defender only, never by the matchup.** What a unit does when
 * cavalry hits its line is about its own equipment, not about who is arriving --
 * and the attacker-versus-defender dimension is already spent on
 * `CHARGE_THRESHOLD`. The split is the point: **the threshold says how likely,
 * the repel says what failing costs.** Two questions, two tables, neither doing
 * the other's job.
 *
 * ⚠️ **Not the defender's own `BASE_DAMAGE` row**, which was considered and
 * refused: artillery's row is *ranged* fire, and borrowing it at contact would
 * make a battery as dangerous close as far.
 *
 * ⚠️ **This is not the "defence stat" the damage design refuses.** That refusal
 * is about *damage*, where a scalar defence forces a transitive ordering and
 * makes a triangle impossible. Repel takes no part in the damage formula and
 * orders nothing: it is a punishment, not a toughness.
 */
export const CHARGE_REPEL: Record<UnitTypeId, number> = {
  infantry: 10,
  cavalry: 5,
  artillery: 8,
};

/**
 * Every this many points of health above the threshold **halves** the odds.
 *
 * ⚠️ **This sets how wide the in-between odds are; `CHARGE_THRESHOLD` sets
 * where they sit.** Lowering a threshold slides the band down the health scale
 * without narrowing it. A shorter half-life narrows it, at the price of the long
 * shot against a healthy unit.
 */
export const CHARGE_HALF_LIFE = 10;

/**
 * A floor under the charge margin, which is a **ceiling on the odds**: the
 * margin can never fall below it, so the chance can never rise above
 * `0.5 ^ (floor / CHARGE_HALF_LIFE)`.
 *
 * `FRONTAL_FLOOR` applies only to a charge arriving head-on; `FLOOR_PER_STAR`
 * applies on any side, multiplied by the defender's cover. Both live in margin
 * space, which is why neither needs a per-matchup table -- a margin means the
 * same thing whoever is charging whom. What differs between matchups is how
 * easily each *reaches* the ceiling, and `CHARGE_THRESHOLD` already says that:
 * the ceiling arrives at exactly the threshold.
 *
 * ⚠️ **Tuned against `CHARGE_HALF_LIFE`, never alone**: a ceiling is
 * `floor / half-life`, so moving one moves every ceiling unless the other
 * follows. `charge.test.ts` pins the ceilings.
 *
 * ⚠️ **`FRONTAL_FLOOR` equals `FLOOR_PER_STAR` on purpose** -- facing a unit
 * head-on is worth one star of terrain to it. Nothing depends on the two being
 * equal; it is a starting position, not a constraint.
 *
 * ⚠️ **They replace terrain's flat contribution rather than adding to it.**
 * Cover used to add its stars straight onto the margin -- at most 4 against a
 * 100-point scale, which is nothing. Folding it into the floor concentrates
 * terrain where it is felt, and the accepted cost is that terrain stops
 * affecting a charge that was a long shot anyway.
 *
 * ⚠️ **What this really buys is that no charge is free.** `resolveCharge`
 * exacts a repel only when a charge *fails*, so a certain charge was a
 * guaranteed kill at no cost -- the one move in the game with no downside.
 * Head-on is capped at 87% on open ground and 50% on a peak.
 */
export const FRONTAL_FLOOR = 2;
export const FLOOR_PER_STAR = 2;

/**
 * What a failed charge's overshoot is divided by before being added to the flat
 * repel cost.
 *
 * ⚠️ **Ten, so that no cap is needed.** The overshoot cannot exceed 99, so this
 * tops the term out at **+9** on its own -- the same band as `LUCK_MAX`, which
 * keeps charge from introducing a second, differently scaled idea of variance.
 * Halving it doubles the swing.
 */
export const REPEL_DIVISOR = 10;

/**
 * What a charge into an unready side is worth, as a **multiplier on the
 * threshold**.
 *
 * ⚠️ **Multiplied, never added, and the reason is retuning.** An additive
 * constant stops meaning anything the moment the table underneath it moves --
 * halve every threshold and a flat `+20` goes from a nudge to an override. A
 * multiplier is scale-free, so `CHARGE_THRESHOLD` can be retuned without
 * dragging these behind it. They also read as what they are: a rear charge is
 * *twice as likely to break them*, not *twenty more points of something*.
 *
 * ⚠️ **They have to be worth manoeuvring for.** At ×1.15 the flank moved 20% to
 * 23% -- inside the noise, a rule to learn that never changes a decision. These
 * move the curve enough to be a reason to ride around someone.
 *
 * ⚠️ **A multiplied threshold can exceed 100**, and the charge is then automatic
 * against any health at all. That is deliberate and it is the mechanic's
 * signature moment -- cavalry into the rear of a battery -- but it is also why a
 * base value wants checking at *all three* multipliers rather than head-on
 * alone: one that reads reasonable front-on can saturate at the flank and leave
 * the rear distinction doing nothing. `scripts/charges.ts` prints all three for
 * exactly that.
 */
export const FLANK_MULTIPLIER = 1.5;
export const REAR_MULTIPLIER = 2;
