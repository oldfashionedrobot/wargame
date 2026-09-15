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
 * Its identity lives in the charge table (10a), and a cavalry that also shoots
 * well has no reason to close. Six hits to kill infantry is what makes that
 * true rather than merely stated.
 */
export const BASE_DAMAGE: Record<UnitTypeId, Record<UnitTypeId, number>> = {
  infantry: { infantry: 30, cavalry: 35, artillery: 45 },
  cavalry: { infantry: 20, cavalry: 25, artillery: 30 },
  artillery: { infantry: 75, cavalry: 60, artillery: 40 },
};

/**
 * The widest the luck bonus ever gets, matching AW exactly.
 *
 * ⚠️ **Additive, never multiplicative, and applied last** -- see `computeDamage`,
 * where getting this wrong twice is documented. It makes weak attacks the swingy
 * ones: 9 points on a volley of 18 is +50%, the same 9 on artillery's 67 is
 * +13%. A crippled unit's best roll is most of its remaining threat.
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
 * Target health at or below which a charge is **certain**, attacker down the
 * side. A percentage, read against the defender's raw health.
 *
 * ⚠️ **`Partial`, and the missing row is the rule.** Artillery has none, which is
 * how "artillery cannot charge" is said -- rather than a `canCharge` flag on the
 * unit catalog saying the same thing a second time, where the two could drift.
 * Any unit can still be a *target*.
 *
 * ⚠️ **The triangle closes here, not in `BASE_DAMAGE`.** Cavalry loses the
 * shooting exchange with artillery -- 30 out against 60 back -- so it has to
 * close, and `cavalry → artillery 60` is what makes closing pay. Against
 * infantry it is 25: a frontal charge needs a nearly-dead target, which is what
 * "infantry beats cavalry by not breaking" has to mean numerically.
 *
 * ⚠️ `infantry → cavalry 15` is the lowest number in either table on purpose.
 * Charging cavalry on foot should almost never be the right call, and a number
 * says so more cheaply than a rule forbidding it.
 *
 * ⚠️ **Untuned.** Nothing has been played. These exist so the harness has
 * something to print and so tuning starts from a position rather than a blank.
 */
export const CHARGE_THRESHOLD: Partial<Record<UnitTypeId, Record<UnitTypeId, number>>> = {
  cavalry: { infantry: 25, cavalry: 25, artillery: 60 },
  infantry: { infantry: 20, cavalry: 15, artillery: 45 },
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
 * refused: artillery's 60 was tuned as *ranged* fire, and borrowing it at contact
 * would assert a battery is as dangerous close as far -- the opposite of what
 * `range.min: 2` exists to say. Hence 8 here against 60 there.
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
 * ⚠️ **Exponential decay, and the shape is the point** -- one dial with a
 * sentence you can say out loud. At or below the threshold a charge is certain;
 * above it the curve falls away but never reaches zero, so cavalry into a
 * full-health line is a long shot rather than a wall.
 */
export const CHARGE_HALF_LIFE = 15;

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
