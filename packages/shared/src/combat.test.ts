import { describe, expect, it } from 'bun:test';
import { makeState } from './testing';
import { computeDamage } from './combat';
import { BASE_DAMAGE, LUCK_MAX } from './data/combat';
import { MAX_HEALTH } from './data/unitTypes';
import type { GameState, Unit } from './types';

// Two units on a board whose terrain is chosen per test: the defender's tile is
// the only one that matters, since defence comes from terrain and nowhere else.
function fight(
  rows: string[],
  attacker: Partial<Unit> & { unitTypeId?: Unit['unitTypeId'] } = {},
  defender: Partial<Unit> & { unitTypeId?: Unit['unitTypeId'] } = {},
): { state: GameState; a: Unit; d: Unit } {
  const state = makeState(rows, [
    {
      id: 'a',
      col: 0,
      row: 0,
      unitTypeId: attacker.unitTypeId ?? 'infantry',
      health: attacker.health ?? MAX_HEALTH,
    },
    {
      id: 'd',
      col: 1,
      row: 0,
      owner: 'red',
      unitTypeId: defender.unitTypeId ?? 'infantry',
      health: defender.health ?? MAX_HEALTH,
    },
  ]);
  return { state, a: state.units[0], d: state.units[1] };
}

const MOUNTAIN = ['.^', '..']; // the defender stands on the peak
const ROAD = ['.-', '..']; // zero defence, so the terrain term vanishes

describe('computeDamage', () => {
  it('is the table value on open ground, at full health, with no luck', () => {
    const { state, a, d } = fight(ROAD);
    // Road is 0 stars, so the cover term is 100/100 and nothing is taken off.
    expect(computeDamage(state, a, d, 0)).toBe(BASE_DAMAGE.infantry.infantry);
  });

  // The property every matchup number depends on: the table is a percentage of
  // a full-health target, so it has to survive the trip through the formula
  // unchanged when nothing else is in play.
  it('passes every table entry through untouched on open ground', () => {
    for (const attacker of ['infantry', 'cavalry', 'artillery'] as const) {
      for (const defender of ['infantry', 'cavalry', 'artillery'] as const) {
        const { state, a, d } = fight(ROAD, { unitTypeId: attacker }, { unitTypeId: defender });
        expect(computeDamage(state, a, d, 0)).toBe(BASE_DAMAGE[attacker][defender]);
      }
    }
  });

  it('scales down with the attacker’s health, linearly', () => {
    const { state, a, d } = fight(ROAD, { health: 50 });
    expect(computeDamage(state, a, d, 0)).toBe(Math.floor(BASE_DAMAGE.infantry.infantry / 2));
  });

  // ⚠️ The sign check that matters. AW's published formula divides HP by 10
  // because its HP is 1-10; taken literally here it yields 100 - 400 = -300, and
  // a mountain would heal. Anything negative means the rescale was dropped.
  it('reduces damage on defended terrain rather than inverting it', () => {
    const { state, a, d } = fight(MOUNTAIN);
    const open = fight(ROAD);
    const defended = computeDamage(state, a, d, 0);

    expect(defended).toBeGreaterThan(0);
    expect(defended).toBeLessThan(computeDamage(open.state, open.a, open.d, 0));
    // Four stars against a full-health defender is a 40% reduction.
    expect(defended).toBe(Math.floor((BASE_DAMAGE.infantry.infantry * 60) / 100));
  });

  // Cover scales by *defender* health, which is what stops a damaged unit
  // turtling on a peak: the worse it gets, the less the ground does for it.
  it('gives a wounded defender less cover than a healthy one', () => {
    const healthy = fight(MOUNTAIN);
    const wounded = fight(MOUNTAIN, {}, { health: 20 });
    expect(computeDamage(wounded.state, wounded.a, wounded.d, 0)).toBeGreaterThan(
      computeDamage(healthy.state, healthy.a, healthy.d, 0),
    );
  });

  it('adds luck last, flat, and never subtracts', () => {
    const { state, a, d } = fight(ROAD);
    const floorValue = computeDamage(state, a, d, 0);
    for (let roll = 0; roll <= LUCK_MAX; roll++) {
      const damage = computeDamage(state, a, d, roll);
      expect(damage).toBeGreaterThanOrEqual(floorValue);
      expect(damage).toBeLessThanOrEqual(floorValue + LUCK_MAX);
    }
    expect(computeDamage(state, a, d, LUCK_MAX)).toBe(floorValue + LUCK_MAX);
  });

  // ⚠️ The spread does *not* narrow with the attacker's health, and an earlier
  // version of this suite asserted that it did. Luck is added after every
  // multiplication, so it is the same flat band however weak the attacker is --
  // which makes it worth proportionally *more* the worse shape they are in.
  // A ROM-derived reconstruction of the GBA engine is the source; wikis that
  // describe luck as scaling with HP disagree with it.
  it('keeps the luck spread flat however weak the attacker is', () => {
    const spread = (health: number): number => {
      const { state, a, d } = fight(ROAD, { health });
      return computeDamage(state, a, d, LUCK_MAX) - computeDamage(state, a, d, 0);
    };
    expect(spread(MAX_HEALTH)).toBe(LUCK_MAX);
    expect(spread(50)).toBe(LUCK_MAX);
    expect(spread(1)).toBe(LUCK_MAX);
  });

  // The consequence worth stating separately: for a nearly-dead attacker the
  // roll stops being a modifier and becomes most of the attack.
  it('makes luck matter more, not less, to a weakened attacker', () => {
    const share = (health: number): number => {
      const { state, a, d } = fight(ROAD, { health });
      return LUCK_MAX / computeDamage(state, a, d, LUCK_MAX);
    };
    expect(share(1)).toBeGreaterThan(share(MAX_HEALTH));
  });

  it('never returns a negative number', () => {
    const { state, a, d } = fight(MOUNTAIN, { health: 1 }, { unitTypeId: 'artillery' });
    expect(computeDamage(state, a, d, 0)).toBeGreaterThanOrEqual(0);
  });

  // ⚠️ **The tuning guard, and the reason both HP terms read a band.** Before
  // banding, a cavalry unit at 4 health or less dealt *zero* to infantry in
  // forest even on a maximum roll -- so two wounded units could be permanently
  // unable to kill each other, with elimination the only way a match ends.
  //
  // This sweeps every matchup on every terrain at every health, with the worst
  // possible roll. It is a statement about the *table* as much as the formula:
  // drop a base value far enough and the floors will swallow it again, and this
  // is what says so before a playtest does.
  it('leaves no living attacker harmless, in any matchup on any terrain', () => {
    const types = ['infantry', 'cavalry', 'artillery'] as const;
    for (const terrain of ['-', '=', '.', 'f', '^', '~']) {
      for (const attacker of types) {
        for (const defender of types) {
          for (const health of [1, 4, 9, 10, 11, 50, 99, MAX_HEALTH]) {
            const { state, a, d } = fight(
              ['.' + terrain, '..'],
              { unitTypeId: attacker, health },
              { unitTypeId: defender },
            );
            // The whole case in the assertion, so a failure names the matchup
            // and terrain rather than just a line number.
            const damage = computeDamage(state, a, d, 0);
            expect(`${attacker}→${defender} on ${terrain} at ${health}: ${damage}`).not.toMatch(
              /: 0$/,
            );
          }
        }
      }
    }
  });

  // ⚠️ Luck is added after every other step, so it sails past a zeroed base
  // unless something stops it: without the guard a unit at 0 health lands 9.
  it('lets a dead attacker deal nothing, luck included', () => {
    const { state, a, d } = fight(ROAD, { health: 0 });
    expect(computeDamage(state, a, d, 0)).toBe(0);
    expect(computeDamage(state, a, d, LUCK_MAX)).toBe(0);
  });

  it('reads the defender’s terrain, not the attacker’s', () => {
    // Attacker on the peak, defender on the road: the peak must not protect it.
    const state = makeState(
      ['^-', '..'],
      [
        { id: 'a', col: 0, row: 0 },
        { id: 'd', col: 1, row: 0, owner: 'red' },
      ],
    );
    expect(computeDamage(state, state.units[0], state.units[1], 0)).toBe(
      BASE_DAMAGE.infantry.infantry,
    );
  });
});
