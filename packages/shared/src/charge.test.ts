import { describe, expect, it } from 'bun:test';
import { chargeChance, chargeThreshold, refuseCharge, repelDamage, resolveCharge } from './combat';
import {
  CHARGE_HALF_LIFE,
  CHARGE_REPEL,
  CHARGE_THRESHOLD,
  REAR_MULTIPLIER,
  REPEL_DIVISOR_FRESH,
  REPEL_DIVISOR_SPENT,
} from './data/combat';
import { MAX_HEALTH } from './data/unitTypes';
import { at, makeState } from './testing';
import type { GameState, Unit } from './types';

const unit = (state: GameState, id: string): Unit => state.units.find((u) => u.id === id)!;

// A cavalryman beside an infantryman, both on plains unless a map says otherwise.
const contact = (health = 100, rows?: string[]) =>
  makeState(rows ?? 7, [
    { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry' },
    { id: 'r1', col: 1, row: 2, owner: 'red', health },
  ]);

describe('chargeThreshold, which is also the capability rule', () => {
  it('answers for a charger that has a row', () => {
    expect(chargeThreshold('cavalry', 'infantry')).toBe(25);
  });

  // ⚠️ The missing row *is* "artillery cannot charge". A `canCharge` flag beside
  // the table would say it a second time, and the two could drift.
  it('answers null for artillery, which has no row at all', () => {
    expect(chargeThreshold('artillery', 'infantry')).toBeNull();
    expect(CHARGE_THRESHOLD.artillery).toBeUndefined();
  });

  it('lets artillery be charged, which is a different question', () => {
    expect(chargeThreshold('cavalry', 'artillery')).not.toBeNull();
  });

  // ⚠️ **The ceiling on every entry, and the reason the artillery column came
  // down.** A rear charge multiplies the threshold by `REAR_MULTIPLIER`; once
  // that product reaches `MAX_HEALTH` the margin can never be positive, so a
  // rear charge is automatically certain against a *full-health* defender. That
  // is a dead dial rather than a signature moment -- the rear stops being
  // distinguishable from anything else in the row -- and it is invisible in a
  // head-on column, which is how it survived one tuning pass already.
  it('keeps every entry clear of saturating at full health from the rear', () => {
    const saturating = Object.entries(CHARGE_THRESHOLD).flatMap(([charger, row]) =>
      Object.entries(row)
        .filter(([, threshold]) => threshold * REAR_MULTIPLIER >= MAX_HEALTH)
        .map(([target, threshold]) => `${charger}→${target} at ${threshold}`),
    );
    expect(saturating).toEqual([]);
  });
});

describe('chargeChance', () => {
  const oddsOf = (state: GameState) => chargeChance(state, unit(state, 'b1'), unit(state, 'r1'))!;
  const road = (health: number) => contact(health, ['.......', '.-.....', '.-.....', '.......']);

  // ⚠️ **This used to assert the opposite** -- that a charge at or below the
  // threshold was certain. A certain charge cannot be repelled, so it was a
  // guaranteed kill at no cost: the one move in the game with no downside.
  it('is never certain head-on, however spent the target is', () => {
    expect(oddsOf(road(1))).toBeLessThan(100);
    // Both sit on the ceiling, so being weaker stops helping once it is reached.
    expect(oddsOf(road(1))).toBe(oddsOf(road(25)));
  });

  // ⚠️ A ceiling is `floor / half-life`, so the floors are tuned against
  // CHARGE_HALF_LIFE rather than alone. Moving one without the other moves every
  // ceiling, and this is what notices.
  it('caps head-on at 87% in the open and an even chance on a mountain', () => {
    expect(oddsOf(road(1))).toBe(87);
    expect(oddsOf(contact(1, ['.......', '.-.....', '.^.....', '.......']))).toBe(50);
  });

  // The other half of the sentence: **position *and* open ground**, not either.
  it('is certain from behind, but only on open ground', () => {
    const behind = (rows: string[]) =>
      makeState(rows, [
        { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry' },
        { id: 'r1', col: 1, row: 2, owner: 'red', health: 25, facing: 'north' },
      ]);
    expect(oddsOf(behind(['...', '.-.', '.-.']))).toBe(100);
    expect(oddsOf(behind(['...', '.-.', '.^.']))).toBeLessThan(100);
  });

  // ⚠️ The shape, stated as the dial it is: every CHARGE_HALF_LIFE points of
  // health above the threshold halves the odds.
  it('halves for every half-life of health above it', () => {
    const near = contact(25 + CHARGE_HALF_LIFE);
    const far = contact(25 + CHARGE_HALF_LIFE * 2);
    const a = chargeChance(near, unit(near, 'b1'), unit(near, 'r1'))!;
    const b = chargeChance(far, unit(far, 'b1'), unit(far, 'r1'))!;
    expect(b / a).toBeCloseTo(0.5, 1);
  });

  // Infantry into fresh cavalry is under half a percent, which rounds to zero.
  it('never reaches zero, however hopeless', () => {
    const state = makeState(7, [
      { id: 'b1', col: 1, row: 1 },
      { id: 'r1', col: 1, row: 2, owner: 'red', unitTypeId: 'cavalry' },
    ]);
    expect(chargeChance(state, unit(state, 'b1'), unit(state, 'r1'))).toBe(1);
  });

  it('is null for a unit that cannot charge', () => {
    const guns = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'artillery' },
      { id: 'r1', col: 1, row: 2, owner: 'red' },
    ]);
    expect(chargeChance(guns, unit(guns, 'b1'), unit(guns, 'r1'))).toBeNull();
  });

  // ⚠️ Terrain sets a floor under the margin, which caps the odds a charge can
  // reach rather than adding a second mechanism beside the formula.
  // ⚠️ **Aimed at a target near the threshold, and that is not incidental.**
  // Cover is a ceiling rather than a nudge, so it changes nothing about a
  // charge that was already a long shot -- at 55 health the margin is 30 and no
  // floor reaches it. This asserted exactly that case before the floor existed,
  // and passed for the other reason.
  it('is harder against a target in cover', () => {
    const wood = contact(25, ['.......', '.-.....', '.f.....', '.......']);
    expect(oddsOf(wood)).toBeLessThan(oddsOf(road(25)));
  });

  // ⚠️ The stated cost of concentrating terrain where it is felt: a charge that
  // was hopeless stays exactly as hopeless in a wood as in the open.
  it('leaves a long shot alone, wherever the target is standing', () => {
    const wood = contact(55, ['.......', '.-.....', '.f.....', '.......']);
    expect(oddsOf(wood)).toBe(oddsOf(road(55)));
  });

  // The attacker's own ground is irrelevant: cover protects whoever is in it.
  it('does not care what the attacker is standing on', () => {
    const a = contact(55, ['.......', '.f.....', '.-.....', '.......']);
    const b = contact(55, ['.......', '.-.....', '.-.....', '.......']);
    expect(chargeChance(a, unit(a, 'b1'), unit(a, 'r1'))).toBe(
      chargeChance(b, unit(b, 'b1'), unit(b, 'r1')),
    );
  });
});

describe('chargeChance, by which side it arrives on', () => {
  // ⚠️ The *defender's* facing decides the side, so the approach is set by
  // turning the target rather than by moving the charger. b1 always comes from
  // the south: `south` is looking at it, `north` is looking away, `east` takes
  // it on the flank.
  const facing = (look: 'south' | 'east' | 'north', health = 70) =>
    makeState(
      ['...', '.-.', '.-.'],
      [
        { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry' },
        { id: 'r1', col: 1, row: 2, owner: 'red', health, facing: look },
      ],
    );
  const odds = (state: GameState) => chargeChance(state, unit(state, 'b1'), unit(state, 'r1'))!;

  it('is easier from the flank than head-on, and easier still from behind', () => {
    expect(odds(facing('east'))).toBeGreaterThan(odds(facing('south')));
    expect(odds(facing('north'))).toBeGreaterThan(odds(facing('east')));
  });

  // ⚠️ Worth manoeuvring for, which is the bar the multipliers were set against:
  // ×1.15 moved 20% to 23%, inside the noise and never worth a decision.
  it('moves the curve enough to be a reason to ride around someone', () => {
    expect(odds(facing('north'))).toBeGreaterThanOrEqual(odds(facing('south')) * 2);
  });

  // Both flanks are the same side: the classifier does not tell left from right,
  // and neither should this.
  it('treats either flank alike', () => {
    expect(odds(facing('east'))).toBe(
      chargeChance(
        makeState(
          ['...', '.-.', '.-.'],
          [
            { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry' },
            { id: 'r1', col: 1, row: 2, owner: 'red', health: 70, facing: 'west' },
          ],
        ),
        unit(facing('east'), 'b1'),
        { ...unit(facing('east'), 'r1'), facing: 'west' },
      )!,
    );
  });

  // ⚠️ **Read from where the attacker will be standing, not where it started.**
  // Both callers hand over the moved unit; pricing a charge by where the ride
  // began would let a unit circle to the rear and be charged as though it had
  // not. Same board, same target, two different attacker positions.
  it('reads the side from the attacker’s destination', () => {
    const board = makeState(
      ['....', '.--.', '.--.', '....'],
      [
        { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry' },
        { id: 'r1', col: 1, row: 2, owner: 'red', health: 70, facing: 'south' },
      ],
    );
    const fromSouth = unit(board, 'b1'); // where it stands: head-on
    const fromEast = { ...fromSouth, position: { col: 2, row: 2 } }; // the flank
    expect(chargeChance(board, fromEast, unit(board, 'r1'))!).toBeGreaterThan(
      chargeChance(board, fromSouth, unit(board, 'r1'))!,
    );
  });

  // ⚠️ **Cover compresses position, and nothing was built for it.** The floor
  // is shared across the sides, so as it rises the gap between a head-on charge
  // and one from behind closes on its own. *Taking cover protects your flanks*
  // falls out of the same constant as *cover is hard to charge* -- one of them
  // was designed and the other came free.
  it('closes the gap between the sides as cover deepens', () => {
    const ground = (tile: string, look: 'south' | 'north') =>
      makeState(
        ['...', '.-.', `.${tile}.`],
        [
          { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry' },
          { id: 'r1', col: 1, row: 2, owner: 'red', health: 25, facing: look },
        ],
      );
    const spread = (tile: string) => odds(ground(tile, 'north')) - odds(ground(tile, 'south'));
    expect(spread('^')).toBeLessThan(spread('-'));
    // Still worth riding round, though -- compressed, not erased.
    expect(spread('^')).toBeGreaterThan(0);
  });
});

describe('refuseCharge', () => {
  const b1 = (state: GameState) => unit(state, 'b1');

  it('accepts a legal charge', () => {
    const state = contact();
    expect(refuseCharge(state, b1(state), [at(1, 1)], 'r1')).toBeNull();
  });

  // ⚠️ Contact, never the attacker's range band. Infantry reaches two tiles, so
  // reusing `refuseAttack` here would permit a "charge" from a distance.
  it('refuses anything that is not contact', () => {
    const apart = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'infantry' },
      { id: 'r1', col: 1, row: 3, owner: 'red' },
    ]);
    expect(refuseCharge(apart, b1(apart), [at(1, 1)], 'r1')).toBe('a charge has to reach them');
  });

  it('refuses a charger with no row', () => {
    const guns = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'artillery' },
      { id: 'r1', col: 1, row: 2, owner: 'red' },
    ]);
    expect(refuseCharge(guns, b1(guns), [at(1, 1)], 'r1')).toBe('artillery cannot charge');
  });

  it('refuses a friend and refuses itself', () => {
    const friendly = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry' },
      { id: 'b2', col: 1, row: 2 },
    ]);
    expect(refuseCharge(friendly, b1(friendly), [at(1, 1)], 'b2')).toBe('that unit is yours');
    expect(refuseCharge(friendly, b1(friendly), [at(1, 1)], 'b1')).toBe('that unit is yours');
  });

  // ⚠️ **The rule `entryCost` could not answer, and it is currently
  // unreachable.** A successful charge displaces onto the target's tile, so the
  // attacker has to be able to stand there -- and `entryCost` refuses that tile
  // for being enemy-held, which is the one objection a charge is not troubled
  // by. `terrainAdmits` is the shared half.
  //
  // ⚠️ **Nothing that can charge is barred from anywhere any more.** Only
  // `foot` and `horse` have a `CHARGE_THRESHOLD` row, and since `horse` went to
  // 3 in the river both can enter every terrain on the board -- `wheels` is the
  // only movement type with a `null`, and artillery cannot charge. So this
  // asserts the *reachable* truth: a charge across water is now allowed.
  it('allows a charge onto water, which it used to refuse', () => {
    const river = contact(100, ['.......', '.-.....', '.~.....', '.......']);
    expect(refuseCharge(river, b1(river), [at(1, 1)], 'r1')).toBeNull();
  });

  // ⚠️ **The guard stays despite having nothing to catch**, and cheaply: a unit
  // type that charges on `wheels`, or a terrain barred to `foot`, brings it back
  // the same day it is added. It is insurance against the catalog growing, not
  // dead weight -- `CHARGE_THRESHOLD` is `Partial`, so a new charger is exactly
  // the change that arrives quietly.

  it('allows ground the attacker can stand on, enemy or not', () => {
    const wood = contact(100, ['.......', '.-.....', '.f.....', '.......']);
    expect(refuseCharge(wood, b1(wood), [at(1, 1)], 'r1')).toBeNull();
  });
});

describe('resolveCharge', () => {
  const resolve = (state: GameState, roll: number) =>
    resolveCharge(state, unit(state, 'b1'), unit(state, 'r1'), { charge: roll });

  it('kills outright and answers nothing when it breaks through', () => {
    const state = contact(40);
    const chance = chargeChance(state, unit(state, 'b1'), unit(state, 'r1'))!;
    const battle = resolve(state, chance - 1);
    expect(battle.kind).toBe('charge');
    expect(battle.defender.health).toBe(0);
    expect(battle.attacker.health).toBe(100);
    expect(battle.answered).toBe(false);
  });

  // ⚠️ `answered` means *repelled* here, not "fired back". A charge never asks
  // the counter rule -- doing so would make charging artillery free, since a
  // battery cannot answer at contact.
  it('leaves the target untouched and marks it answered when repelled', () => {
    const state = contact(40);
    const chance = chargeChance(state, unit(state, 'b1'), unit(state, 'r1'))!;
    const battle = resolve(state, chance);
    expect(battle.defender.health).toBe(40);
    expect(battle.attacker.health).toBeLessThan(100);
    expect(battle.answered).toBe(true);
  });

  // ⚠️ The flat cost is paid on *every* failure, and it is the number in the
  // table -- which is why the table reads as a floor rather than a ceiling.
  it('costs the flat repel for a near miss', () => {
    const state = contact(40);
    const chance = chargeChance(state, unit(state, 'b1'), unit(state, 'r1'))!;
    expect(resolve(state, chance).attacker.health).toBe(100 - CHARGE_REPEL.infantry);
  });

  it('charges what repelDamage says for the roll that failed it', () => {
    const state = contact(100);
    const chance = chargeChance(state, unit(state, 'b1'), unit(state, 'r1'))!;
    expect(100 - resolve(state, 99).attacker.health).toBe(
      repelDamage(unit(state, 'r1'), chance, 99),
    );
  });

  it('never drives the attacker below zero', () => {
    const dying = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry', health: 2 },
      { id: 'r1', col: 1, row: 2, owner: 'red' },
    ]);
    const chance = chargeChance(dying, unit(dying, 'b1'), unit(dying, 'r1'))!;
    expect(
      resolveCharge(dying, unit(dying, 'b1'), unit(dying, 'r1'), { charge: 99 }).attacker.health,
    ).toBe(0);
    expect(chance).toBeGreaterThanOrEqual(1);
  });
});

describe('repelDamage', () => {
  const defender = (health: number) => unit(contact(health), 'r1');
  const base = CHARGE_REPEL.infantry;

  it('divides the overshoot by REPEL_DIVISOR_SPENT against a unit in its last band', () => {
    expect(repelDamage(defender(5), 1, 1 + REPEL_DIVISOR_SPENT * 3)).toBe(base + 3);
  });

  it('and by REPEL_DIVISOR_FRESH against one at full health', () => {
    expect(repelDamage(defender(100), 1, 1 + REPEL_DIVISOR_FRESH * 3)).toBe(base + 3);
  });

  it('costs the base alone for a near miss, whatever the defender’s health', () => {
    for (const health of [5, 50, 100]) expect(repelDamage(defender(health), 30, 30)).toBe(base);
  });

  it('never swings narrower against a healthier defender', () => {
    const worst = (health: number) => repelDamage(defender(health), 1, 99);
    for (let health = 10; health < 100; health += 10) {
      expect(worst(health + 10)).toBeGreaterThanOrEqual(worst(health));
    }
    expect(worst(100)).toBeGreaterThan(worst(10));
  });

  // The divisor is worked in whole numbers so no band floors a point short of
  // the ratio it states; that needs both ends whole.
  it('keeps both ends of the divisor whole, the fresh end the smaller', () => {
    expect(Number.isInteger(REPEL_DIVISOR_SPENT)).toBe(true);
    expect(Number.isInteger(REPEL_DIVISOR_FRESH)).toBe(true);
    expect(REPEL_DIVISOR_FRESH).toBeGreaterThan(0);
    expect(REPEL_DIVISOR_SPENT).toBeGreaterThanOrEqual(REPEL_DIVISOR_FRESH);
  });

  it('lands every band on the ratio it states', () => {
    for (let band = 1; band <= 10; band++) {
      const divisor =
        REPEL_DIVISOR_SPENT - ((REPEL_DIVISOR_SPENT - REPEL_DIVISOR_FRESH) * (band - 1)) / 9;
      for (let miss = 0; miss <= 98; miss++) {
        expect(repelDamage(defender(band * 10), 1, 1 + miss)).toBe(
          base + Math.floor(miss / divisor + 1e-9),
        );
      }
    }
  });
});
