import { describe, expect, it } from 'bun:test';
import { makeState } from './testing';
import { isOver, soleSurvivor } from './victory';

describe('soleSurvivor', () => {
  it('is nobody while both sides have units', () => {
    const state = makeState(8, [
      { id: 'b1', col: 0, row: 0 },
      { id: 'r1', col: 0, row: 3, owner: 'red' },
    ]);
    expect(soleSurvivor(state)).toBeNull();
  });

  it('is the side still holding units when the other has none', () => {
    const state = makeState(8, [{ id: 'b1', col: 0, row: 0 }]);
    expect(soleSurvivor(state)).toBe('blue');
  });

  // ⚠️ The half that would be missing from "whoever isn't the loser". That
  // spelling answers with a player id here, because there *is* someone who is
  // not the loser -- both of them. This is the case that makes sole-survivor
  // the N-player predicate rather than a wordier two-player one.
  it('is nobody on an empty board rather than crowning players[0]', () => {
    expect(soleSurvivor(makeState(8, []))).toBeNull();
  });

  // The winner is whoever is left, not whoever moved -- asserted from the other
  // side so a hardcoded 'blue' cannot pass.
  it('names red just as readily as blue', () => {
    const state = makeState(8, [{ id: 'r1', col: 0, row: 0, owner: 'red' }]);
    expect(soleSurvivor(state)).toBe('red');
  });

  // ⚠️ It reads the roster, not the marker: a state can satisfy the condition
  // before the event that records it exists, which is exactly the moment
  // `resolveAction` asks.
  it('does not consult the winner already recorded on the state', () => {
    const state = makeState(8, [{ id: 'b1', col: 0, row: 0 }], 'blue', 'red');
    expect(soleSurvivor(state)).toBe('blue');
  });
});

describe('isOver', () => {
  it('follows the marker and nothing else', () => {
    const playing = makeState(8, [{ id: 'b1', col: 0, row: 0 }]);
    // ⚠️ One unit left and the game is *not* over: the condition has been met
    // but no resolution has recorded it. The marker is the fact; the roster is
    // what produces it, once.
    expect(isOver(playing)).toBe(false);
    expect(isOver(makeState(8, [{ id: 'b1', col: 0, row: 0 }], 'blue', 'blue'))).toBe(true);
  });
});
