import { describe, expect, it } from 'bun:test';
import { chargeReach, hasChargeMeter, refuseCharge, resolveBattle, resolveCharge } from './combat';
import {
  CHARGE_COVER_PER_STAR,
  CHARGE_FACING,
  CHARGE_METER_FULL,
  CHARGE_THRESHOLD,
} from './data/combat';
import { TERRAIN } from './data/terrain';
import { MAX_HEALTH } from './data/unitTypes';
import type { UnitTypeId } from './data/unitTypes';
import { at, makeState } from './testing';
import type { Facing, GameState, Unit } from './types';

const unit = (state: GameState, id: string): Unit => state.units.find((u) => u.id === id)!;

// Read off the table rather than written out, so retuning it fails nothing here.
const THRESHOLD = CHARGE_THRESHOLD.cavalry!.infantry;

/**
 * A full-meter cavalryman just south of an infantryman, the target on plains
 * unless told otherwise. ⚠️ The target looks `south` by default -- straight at
 * the charger -- so a charge is head-on unless a test turns it.
 */
const contact = ({
  health = MAX_HEALTH,
  facing = 'south' as Facing,
  ground = '.',
  charger = MAX_HEALTH,
  meter = CHARGE_METER_FULL,
} = {}) =>
  makeState(
    ['...', '.-.', `.${ground}.`],
    [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry', health: charger, chargeMeter: meter },
      { id: 'r1', col: 1, row: 2, owner: 'red', health, facing },
    ],
  );

const reach = (state: GameState) => chargeReach(state, unit(state, 'b1'), unit(state, 'r1'));

describe('hasChargeMeter, which is also the capability rule', () => {
  it('is true for a unit with a threshold row', () => {
    expect(hasChargeMeter('cavalry')).toBe(true);
    expect(hasChargeMeter('infantry')).toBe(true);
  });

  // ⚠️ The missing row *is* "artillery cannot charge". A `canCharge` flag beside
  // the table would say it a second time, and the two could drift.
  it('is false for artillery, which has no row at all', () => {
    expect(hasChargeMeter('artillery')).toBe(false);
    expect(CHARGE_THRESHOLD.artillery).toBeUndefined();
  });

  // ⚠️ **The ceiling on every entry.** A rear charge that reaches `MAX_HEALTH`
  // executes a *full-health* unit -- a dead dial rather than a signature
  // moment, and invisible in a head-on column.
  it('keeps every entry short of executing a full-health unit from the rear', () => {
    const reaching = Object.entries(CHARGE_THRESHOLD).flatMap(([charger, row]) =>
      Object.entries(row)
        .filter(([, threshold]) => threshold * CHARGE_FACING.rear >= MAX_HEALTH * 100)
        .map(([target, threshold]) => `${charger}→${target} at ${threshold}`),
    );
    expect(reaching).toEqual([]);
  });

  it('keeps the deepest cover short of taking a whole charge', () => {
    const deepest = Math.max(...Object.values(TERRAIN).map(({ defense }) => defense));
    expect(CHARGE_COVER_PER_STAR * deepest).toBeLessThan(100);
  });
});

describe('chargeReach', () => {
  it('is the threshold itself from the flank, in the open, at full strength', () => {
    expect(reach(contact({ facing: 'east' }))).toBe(THRESHOLD);
  });

  // "Harder" is a smaller number: the health the target must be at or under.
  it('always gives the defender a better chance head-on', () => {
    const front = reach(contact({ facing: 'south' }))!;
    const flank = reach(contact({ facing: 'east' }))!;
    const rear = reach(contact({ facing: 'north' }))!;
    expect(front).toBeLessThan(flank);
    expect(flank).toBeLessThan(rear);
  });

  it('falls in a straight line with the charger’s own health', () => {
    for (const charger of [100, 75, 50, 25]) {
      expect(reach(contact({ facing: 'east', charger }))).toBe(
        Math.floor((THRESHOLD * charger) / MAX_HEALTH),
      );
    }
  });

  it('takes a share off for each star of the target’s cover', () => {
    const open = reach(contact({ facing: 'east' }))!;
    const wood = reach(contact({ facing: 'east', ground: 'f' }))!;
    const peak = reach(contact({ facing: 'east', ground: '^' }))!;
    expect(wood).toBeLessThan(open);
    expect(peak).toBe(
      Math.floor((THRESHOLD * (100 - TERRAIN.mountain.defense * CHARGE_COVER_PER_STAR)) / 100),
    );
  });

  it('reads the side from where the charger stands', () => {
    const state = contact({ facing: 'south' });
    const fromWest = { ...unit(state, 'b1'), position: at(0, 2) };
    expect(chargeReach(state, fromWest, unit(state, 'r1'))).toBe(THRESHOLD);
  });

  it('is null for a charger with no row', () => {
    const guns = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'artillery' },
      { id: 'r1', col: 1, row: 2, owner: 'red' },
    ]);
    expect(reach(guns)).toBeNull();
  });
});

describe('refuseCharge', () => {
  const b1 = (state: GameState) => unit(state, 'b1');

  // Inclusive: a target sitting exactly on the line is executed.
  it('accepts a charge that executes', () => {
    const state = contact({ health: reach(contact())! });
    expect(refuseCharge(state, b1(state), [at(1, 1)], 'r1')).toBeNull();
  });

  // ⚠️ **Not offered rather than failed.** A charge is a sure execute, so the
  // rule that it must kill lives here, and the panel and the lit tiles follow.
  it('refuses a charge that would not execute', () => {
    const state = contact({ health: reach(contact())! + 1 });
    expect(refuseCharge(state, b1(state), [at(1, 1)], 'r1')).toBe('they are too strong to break');
  });

  it('refuses a charger whose meter is not full', () => {
    const state = contact({ health: 1, meter: CHARGE_METER_FULL - 1 });
    expect(refuseCharge(state, b1(state), [at(1, 1)], 'r1')).toBe('the charge meter is not full');
  });

  // ⚠️ `validateMove` hands over the unit as it stood, so the side has to come
  // from the path. Read from the unit's own tile, this would price a charge by
  // where the ride started and the server and the panel could disagree.
  it('reads the side from where the charge ends, not where the unit started', () => {
    const state = makeState(5, [
      { id: 'b1', col: 1, row: 0, unitTypeId: 'cavalry', chargeMeter: CHARGE_METER_FULL },
      // Between what a head-on and a flank charge execute.
      { id: 'r1', col: 2, row: 2, owner: 'red', health: THRESHOLD - 1, facing: 'south' },
    ]);
    const toFlank = [at(1, 0), at(1, 1), at(1, 2)];
    const toFront = [at(1, 0), at(2, 0), at(2, 1)];
    expect(refuseCharge(state, b1(state), toFlank, 'r1')).toBeNull();
    expect(refuseCharge(state, b1(state), toFront, 'r1')).toBe('they are too strong to break');
  });

  // ⚠️ Contact, never the attacker's range band. Infantry reaches two tiles, so
  // reusing `refuseAttack` here would permit a "charge" from a distance.
  it('refuses anything that is not contact', () => {
    const apart = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'infantry', chargeMeter: CHARGE_METER_FULL },
      { id: 'r1', col: 1, row: 3, owner: 'red', health: 1 },
    ]);
    expect(refuseCharge(apart, b1(apart), [at(1, 1)], 'r1')).toBe('a charge has to reach them');
  });

  it('refuses a charger with no row', () => {
    const guns = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'artillery', chargeMeter: CHARGE_METER_FULL },
      { id: 'r1', col: 1, row: 2, owner: 'red', health: 1 },
    ]);
    expect(refuseCharge(guns, b1(guns), [at(1, 1)], 'r1')).toBe('artillery cannot charge');
  });

  it('refuses a friend and refuses itself', () => {
    const friendly = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId: 'cavalry', chargeMeter: CHARGE_METER_FULL },
      { id: 'b2', col: 1, row: 2, health: 1 },
    ]);
    expect(refuseCharge(friendly, b1(friendly), [at(1, 1)], 'b2')).toBe('that unit is yours');
    expect(refuseCharge(friendly, b1(friendly), [at(1, 1)], 'b1')).toBe('that unit is yours');
  });

  // ⚠️ **The rule `entryCost` could not answer, and it is currently
  // unreachable.** A charge displaces onto the target's tile, so the attacker
  // has to be able to stand there -- and `entryCost` refuses that tile for being
  // enemy-held, which is the one objection a charge is not troubled by.
  // `terrainAdmits` is the shared half.
  //
  // ⚠️ **Nothing that can charge is barred from anywhere any more.** Only
  // `foot` and `horse` have a `CHARGE_THRESHOLD` row, and both can enter every
  // terrain on the board -- `wheels` is the only movement type with a `null`,
  // and artillery cannot charge. So this asserts the *reachable* truth.
  it('allows a charge onto water', () => {
    const river = contact({ health: 1, ground: '~' });
    expect(refuseCharge(river, b1(river), [at(1, 1)], 'r1')).toBeNull();
  });

  // ⚠️ **The guard stays despite having nothing to catch**, and cheaply: a unit
  // type that charges on `wheels`, or a terrain barred to `foot`, brings it back
  // the same day it is added -- `CHARGE_THRESHOLD` is `Partial`, so a new
  // charger is exactly the change that arrives quietly.
  it('allows ground the attacker can stand on, enemy or not', () => {
    const wood = contact({ health: 1, ground: 'f' });
    expect(refuseCharge(wood, b1(wood), [at(1, 1)], 'r1')).toBeNull();
  });
});

describe('resolveCharge', () => {
  it('kills the target, spends the meter, and costs the charger nothing', () => {
    const state = contact({ health: 10, charger: 60 });
    const battle = resolveCharge(unit(state, 'b1'), unit(state, 'r1'));
    expect(battle.kind).toBe('charge');
    expect(battle.defender.health).toBe(0);
    expect(battle.attacker.health).toBe(60);
    expect(battle.attacker.chargeMeter).toBe(0);
    expect(battle.answered).toBe(false);
  });
});

describe('the charge meter', () => {
  const meterAfterAttacking = (unitTypeId: UnitTypeId, chargeMeter: number) => {
    const state = makeState(7, [
      { id: 'b1', col: 1, row: 1, unitTypeId, chargeMeter },
      { id: 'r1', col: 1, row: 2, owner: 'red', facing: 'south' },
    ]);
    const rolls = { attack: 0, counter: 0 };
    return resolveBattle(state, unit(state, 'b1'), unit(state, 'r1'), rolls).attacker.chargeMeter;
  };

  it('fills a point for every attack, up to full', () => {
    expect(meterAfterAttacking('cavalry', 0)).toBe(1);
    expect(meterAfterAttacking('infantry', CHARGE_METER_FULL - 1)).toBe(CHARGE_METER_FULL);
    expect(meterAfterAttacking('cavalry', CHARGE_METER_FULL)).toBe(CHARGE_METER_FULL);
  });

  it('never fills for a unit that cannot charge', () => {
    expect(meterAfterAttacking('artillery', 0)).toBe(0);
  });
});
