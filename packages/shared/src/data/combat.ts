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
 * ⚠️ **Raised fifteen points for infantry and cavalry, to widen the
 * *first-strike* advantage. Artillery's row was left alone**, and the harness is
 * why: at 75 a gun already killed infantry in two hits, so raising it bought
 * lethality in matchups that were already decided rather than in the flat ones
 * this was for. It costs the table's top ratio -- 2.48 rather than 3.45 -- and
 * that number was largely academic, since a defender dying to the first blow
 * never answers at all.
 *
 * ⚠️ **The rest of the reasoning:** The two sides of an exchange use one formula, so there is no dial
 * for "counters hit softer" and there should not be: the whole asymmetry is that
 * a counter is computed on the defender's **post-damage** health, the same as
 * Advance Wars. That makes the table non-linear in exactly the useful direction
 * -- hit harder and the defender loses more bands before answering, so the
 * counter shrinks while the attack grows, and past a base of about 50 it shrinks
 * in absolute terms.
 *
 * At 30 an infantry exchange ran 27 against 21, a ratio of 1.29 and barely a
 * first strike at all; at 45 it is 1.67, and the table now spans **1.29 to
 * 2.48** where AW2's own numbers span 1.11 to 5.06.
 *
 * ⚠️ **Not raised to AW's ceiling**, which a further five would have reached,
 * because it costs two other mechanics: terrain stops changing the hit count in
 * four matchups rather than three, and units stop lingering at the health where
 * a charge is a good bet. AW affords a 5:1 top end with far more unit types to
 * spread a triangle across than three.
 */
export const BASE_DAMAGE: Record<UnitTypeId, Record<UnitTypeId, number>> = {
  infantry: { infantry: 45, cavalry: 50, artillery: 60 },
  cavalry: { infantry: 30, cavalry: 35, artillery: 40 },
  artillery: { infantry: 75, cavalry: 60, artillery: 40 },
};

/**
 * The widest the luck bonus ever gets, matching AW exactly.
 *
 * ⚠️ **Additive, never multiplicative, and applied last** -- see `computeDamage`,
 * where getting this wrong twice is documented. It makes weak attacks the swingy
 * ones: 9 points on a shot of 18 is +50%, the same 9 on artillery's 67 is
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
