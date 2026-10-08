import { describe, expect, it } from 'bun:test';
import type { Command } from '@wargame/shared';
import { LUCK_MAX } from '@wargame/shared';
import { rollLuck } from './rollLuck';

describe('rollLuck', () => {
  // ⚠️ Statistical, but not flaky: at ten equally likely values, missing either
  // end across two thousand draws has a probability of about 0.9^2000.
  // Both members flattened, since each is drawn the same way and both have to
  // be legal -- a bug in one draw and not the other is exactly what a single
  // pooled sample would hide.
  const shot: Command = { type: 'move', unitId: 'b1', path: [{ col: 0, row: 0 }], facing: 'north' };
  const fire = () => {
    const r = rollLuck(shot);
    if ('charge' in r) throw new Error('expected fire rolls for a shot');
    return r;
  };
  const rolls = Array.from({ length: 2000 }, fire);
  const draws = rolls.flatMap(({ attack, counter }) => [attack, counter]);

  it('only ever produces whole numbers', () => {
    expect(draws.every(Number.isInteger)).toBe(true);
  });

  it('stays inside the luck band', () => {
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...draws)).toBeLessThanOrEqual(LUCK_MAX);
  });

  // ⚠️ Two independent draws, not one value copied into both slots. Sharing
  // them would make every counter exactly as lucky as the attack that provoked
  // it, which is a correlation nothing in the design asks for and no assertion
  // elsewhere would notice.
  it('draws the two independently', () => {
    expect(rolls.some(({ attack, counter }) => attack !== counter)).toBe(true);
  });

  // ⚠️ **The kind comes from the command, which is what keeps this legal.** The
  // rule is that the *rules* must never decide how many draws to make -- a
  // counter is drawn whether or not it is used, for exactly that reason. Reading
  // the client's stated attack kind is a different thing, and this pins it: the
  // same call answers differently for a charge.
  describe('for a charge', () => {
    const charging: Command = { ...shot, targetUnitId: 'r1', attackKind: 'charge' };
    const draws = Array.from({ length: 2000 }, () => {
      const r = rollLuck(charging);
      if (!('charge' in r)) throw new Error('expected a charge roll');
      return r.charge;
    });

    it('draws one number, not two', () => {
      expect(rollLuck(charging)).toEqual({ charge: expect.any(Number) });
    });

    // ⚠️ 0..99, not 0..LUCK_MAX: a charge rolls against a *percentage*. Drawing
    // it on the luck band instead would make every charge above 9% certain,
    // which is legal, silent, and would read as the thresholds being far too
    // generous rather than as a bug here.
    it('rolls across the whole percentage range', () => {
      expect(draws.every(Number.isInteger)).toBe(true);
      expect(Math.min(...draws)).toBe(0);
      expect(Math.max(...draws)).toBe(99);
    });
  });

  // ⚠️ The one that earns this suite. `Math.random() * LUCK_MAX` instead of
  // `* (LUCK_MAX + 1)` keeps every value legal and simply never returns the
  // best one -- an attack that can never roll well, with nothing to notice.
  it('reaches both ends of it', () => {
    expect(draws).toContain(0);
    expect(draws).toContain(LUCK_MAX);
  });

  it('draws from the source it is given', () => {
    expect(rollLuck(shot, () => 0.999)).toEqual({ attack: LUCK_MAX, counter: LUCK_MAX });
    expect(rollLuck({ ...shot, targetUnitId: 'r1', attackKind: 'charge' }, () => 0)).toEqual({
      charge: 0,
    });
  });
});
