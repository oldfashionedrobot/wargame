import { describe, expect, it } from 'bun:test';
import { makeState } from './testing';
import { band, BANDS, computeDamage, tilesInRange, wouldCounter } from './combat';
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

// ⚠️ Exported so the board's health ring can draw one segment per band. Pinned
// here because the display's whole claim -- that it cannot promise precision the
// rules lack -- rests on this being the same function the formula reads.
describe('band', () => {
  it('runs 1 to BANDS and never reaches zero while alive', () => {
    expect(band(1)).toBe(1);
    expect(band(10)).toBe(1);
    expect(band(11)).toBe(2);
    expect(band(MAX_HEALTH)).toBe(BANDS);
  });

  // The boundary that decides whether 91 and 100 fight identically. They do.
  it('rounds up, so a whole band shares a step', () => {
    expect(band(91)).toBe(band(MAX_HEALTH));
    expect(band(90)).not.toBe(band(91));
  });
});

describe('wouldCounter', () => {
  const at = (col: number, row: number) => ({ col, row });
  const unitAt = (unitTypeId: 'infantry' | 'cavalry' | 'artillery', col: number, row: number) =>
    makeState(8, [{ id: 'd', col, row, owner: 'red', unitTypeId }]).units[0];

  it('answers inside its own band and nowhere else', () => {
    const gun = unitAt('artillery', 0, 0); // range 2..5
    expect(wouldCounter(gun, at(0, 1))).toBe(false); // reached: too close
    expect(wouldCounter(gun, at(0, 2))).toBe(true);
    expect(wouldCounter(gun, at(0, 5))).toBe(true);
    expect(wouldCounter(gun, at(0, 6))).toBe(false); // outranged
  });

  // ⚠️ Both bounds are inclusive, and this is the only place that is stated
  // twice -- the formula's band and the counter's share one predicate, so an
  // exclusive bound here would be an exclusive bound everywhere.
  it('treats both ends of the band as inside it', () => {
    const foot = unitAt('infantry', 0, 0); // range 1..2
    expect(wouldCounter(foot, at(0, 1))).toBe(true);
    expect(wouldCounter(foot, at(0, 2))).toBe(true);
    expect(wouldCounter(foot, at(0, 3))).toBe(false);
  });

  it('never answers when it did not survive', () => {
    const dead = makeState(8, [{ id: 'd', col: 0, row: 0, owner: 'red', health: 0 }]).units[0];
    expect(wouldCounter(dead, at(0, 1))).toBe(false);
  });

  // Diagonals cost two, like every other distance in the game.
  it('measures in orthogonal steps', () => {
    const foot = unitAt('infantry', 0, 0);
    expect(wouldCounter(foot, at(1, 1))).toBe(true); // two steps
    expect(wouldCounter(foot, at(2, 1))).toBe(false); // three
  });
});

describe('tilesInRange', () => {
  const unit = (unitTypeId: 'infantry' | 'artillery') =>
    makeState(12, [{ id: 'a', col: 5, row: 5, unitTypeId }]).units[0];
  const has = (tiles: { col: number; row: number }[], col: number, row: number) =>
    tiles.some((t) => t.col === col && t.row === row);

  // ⚠️ Reach, not targets: the band is drawn whether or not anything stands in
  // it, because a gun's reach is most of what makes it a gun.
  it('covers the whole band regardless of what is standing there', () => {
    const tiles = tilesInRange(unit('infantry'), { col: 5, row: 5 }, 12, 12);
    expect(has(tiles, 5, 6)).toBe(true); // one away
    expect(has(tiles, 5, 7)).toBe(true); // two
    expect(has(tiles, 5, 8)).toBe(false); // three, out of infantry's band
  });

  it('excludes the tiles a minimum range forbids', () => {
    const tiles = tilesInRange(unit('artillery'), { col: 5, row: 5 }, 12, 12);
    expect(has(tiles, 5, 5)).toBe(false); // its own tile
    expect(has(tiles, 5, 6)).toBe(false); // reached: inside min
    expect(has(tiles, 5, 7)).toBe(true);
    expect(has(tiles, 5, 10)).toBe(true); // five out, the edge of the band
    expect(has(tiles, 5, 11)).toBe(false);
  });

  // Diagonals cost two, like every other distance in the game -- so the band is
  // a diamond, and a square would quietly let a gun reach corners it cannot.
  it('is a diamond, not a square', () => {
    const tiles = tilesInRange(unit('infantry'), { col: 5, row: 5 }, 12, 12);
    expect(has(tiles, 6, 6)).toBe(true); // two steps
    expect(has(tiles, 7, 6)).toBe(false); // three
  });

  it('stays on the board at a corner', () => {
    const corner = makeState(12, [{ id: 'a', col: 0, row: 0, unitTypeId: 'artillery' }]).units[0];
    const tiles = tilesInRange(corner, { col: 0, row: 0 }, 12, 12);
    expect(tiles.every((t) => t.col >= 0 && t.row >= 0)).toBe(true);
  });
});
