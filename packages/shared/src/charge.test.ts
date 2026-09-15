import { describe, expect, it } from 'bun:test';
import { chargeChance, chargeThreshold, refuseCharge, resolveCharge } from './combat';
import { CHARGE_HALF_LIFE, CHARGE_REPEL, CHARGE_THRESHOLD, REPEL_DIVISOR } from './data/combat';
import { makeState } from './testing';
import type { GameState, Unit } from './types';

const at = (col: number, row: number) => ({ col, row });
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
});

describe('chargeChance', () => {
  it('is certain at or below the threshold', () => {
    const state = contact(25);
    // ⚠️ On *road*, so terrain adds nothing -- plains would push it over.
    const flat = contact(25, ['.......', '.-.....', '.-.....', '.......']);
    expect(chargeChance(flat, unit(flat, 'b1'), unit(flat, 'r1'))).toBe(100);
    expect(chargeChance(state, unit(state, 'b1'), unit(state, 'r1'))).toBeLessThan(100);
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

  // ⚠️ Stated rather than emergent: integer rounding would silently produce 0%,
  // and a silent zero contradicts "a long shot rather than a wall". It is also
  // what makes `chance` safe to divide by in the repel.
  it('never reaches zero, however hopeless', () => {
    const state = contact(100);
    expect(chargeChance(state, unit(state, 'b1'), unit(state, 'r1'))).toBeGreaterThanOrEqual(1);
  });

  it('is null for a unit that cannot charge', () => {
    const guns = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'artillery' },
      { id: 'r1', col: 1, row: 2, owner: 'red' },
    ]);
    expect(chargeChance(guns, unit(guns, 'b1'), unit(guns, 'r1'))).toBeNull();
  });

  // ⚠️ Terrain adds to the target's *health*, not to the threshold -- so cover
  // finishes the sentence the formula already asks rather than adding a second
  // mechanism beside it.
  it('is harder against a target in cover', () => {
    const open = contact(55, ['.......', '.-.....', '.-.....', '.......']);
    const wood = contact(55, ['.......', '.-.....', '.f.....', '.......']);
    const a = chargeChance(open, unit(open, 'b1'), unit(open, 'r1'))!;
    const b = chargeChance(wood, unit(wood, 'b1'), unit(wood, 'r1'))!;
    expect(b).toBeLessThan(a);
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

describe('refuseCharge', () => {
  const b1 = (state: GameState) => unit(state, 'b1');

  it('accepts a legal charge', () => {
    const state = contact();
    expect(refuseCharge(state, b1(state), at(1, 1), 'r1')).toBeNull();
  });

  // ⚠️ Contact, never the attacker's range band. Infantry reaches two tiles, so
  // reusing `refuseAttack` here would permit a "charge" from a distance.
  it('refuses anything that is not contact', () => {
    const apart = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'infantry' },
      { id: 'r1', col: 1, row: 3, owner: 'red' },
    ]);
    expect(refuseCharge(apart, b1(apart), at(1, 1), 'r1')).toBe('a charge has to reach them');
  });

  it('refuses a charger with no row', () => {
    const guns = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'artillery' },
      { id: 'r1', col: 1, row: 2, owner: 'red' },
    ]);
    expect(refuseCharge(guns, b1(guns), at(1, 1), 'r1')).toBe('artillery cannot charge');
  });

  it('refuses a friend and refuses itself', () => {
    const friendly = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry' },
      { id: 'b2', col: 1, row: 2 },
    ]);
    expect(refuseCharge(friendly, b1(friendly), at(1, 1), 'b2')).toBe('that unit is yours');
    expect(refuseCharge(friendly, b1(friendly), at(1, 1), 'b1')).toBe(
      'a unit cannot charge itself',
    );
  });

  // ⚠️ **The rule `entryCost` could not answer.** A successful charge displaces
  // onto the target's tile, so the attacker has to be able to stand there --
  // and `entryCost` refuses that tile for being enemy-held, which is the one
  // objection a charge is not troubled by. `terrainAdmits` is the shared half.
  it('refuses ground the attacker could never stand on', () => {
    const river = contact(100, ['.......', '.-.....', '.~.....', '.......']);
    expect(refuseCharge(river, b1(river), at(1, 1), 'r1')).toBe('horse cannot cross river');
  });

  it('allows ground the attacker can stand on, enemy or not', () => {
    const wood = contact(100, ['.......', '.-.....', '.f.....', '.......']);
    expect(refuseCharge(wood, b1(wood), at(1, 1), 'r1')).toBeNull();
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

  // ⚠️ One term, both behaviours: barely-failed costs the base, and a wild
  // charge overshoots further because it leaves a wider window to fail into.
  it('adds the overshoot, divided', () => {
    const state = contact(40);
    const chance = chargeChance(state, unit(state, 'b1'), unit(state, 'r1'))!;
    const wild = resolve(state, chance + REPEL_DIVISOR * 3);
    expect(100 - wild.attacker.health).toBe(CHARGE_REPEL.infantry + 3);
  });

  // The overshoot cannot exceed 99, so the term tops out at +9 without a cap --
  // the same band as LUCK_MAX, which is why the divisor is ten.
  it('never adds more than the luck band, with no cap written', () => {
    const state = contact(100);
    const worst = resolve(state, 99);
    expect(100 - worst.attacker.health).toBeLessThanOrEqual(CHARGE_REPEL.infantry + 9);
  });

  it('keyed by who was charged, not by the matchup', () => {
    const guns = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry' },
      { id: 'r1', col: 1, row: 2, owner: 'red', unitTypeId: 'artillery', health: 100 },
    ]);
    const chance = chargeChance(guns, unit(guns, 'b1'), unit(guns, 'r1'))!;
    const battle = resolveCharge(guns, unit(guns, 'b1'), unit(guns, 'r1'), { charge: chance });
    expect(100 - battle.attacker.health).toBe(CHARGE_REPEL.artillery);
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
