import { describe, expect, it } from 'bun:test';
import { makeState } from './testing';
import { actionEndsTurn, actionsAllowed, actionsTaken, nextPlayer } from './turns';

// A turn is a budget of actions, and `hasActed` is what spends it. These pin
// the arithmetic; `action.test.ts` pins that resolution acts on the answer.

describe('actionsAllowed', () => {
  it('is the budget while the roster is longer', () => {
    const state = makeState(8, [
      { id: 'b1', col: 0, row: 0 },
      { id: 'b2', col: 1, row: 0 },
      { id: 'b3', col: 2, row: 0 },
    ]);
    expect(actionsAllowed(state, 2)).toBe(2);
  });

  // ⚠️ The half that is easy to leave out and fatal to. A player who cannot
  // reach the budget would never end their turn on its own, so "everyone has
  // acted" has to finish a turn as surely as "the budget is gone".
  it('is the roster while it is shorter than the budget', () => {
    const state = makeState(8, [{ id: 'b1', col: 0, row: 0 }]);
    expect(actionsAllowed(state, 5)).toBe(1);
  });

  it('is nothing at all for a player with no units left', () => {
    const state = makeState(8, [{ id: 'r1', col: 5, row: 5, owner: 'red' }]);
    expect(actionsAllowed(state, 5)).toBe(0);
  });
});

describe('actionsTaken', () => {
  it('counts the current player only, spent or not', () => {
    const state = makeState(8, [
      { id: 'b1', col: 0, row: 0, hasActed: true },
      { id: 'b2', col: 1, row: 0 },
      // Red's spent units are none of blue's business, and stay spent across
      // the boundary until their own turn refreshes them.
      { id: 'r1', col: 5, row: 5, owner: 'red', hasActed: true },
      { id: 'r2', col: 6, row: 5, owner: 'red', hasActed: true },
    ]);
    expect(actionsTaken(state)).toBe(1);
  });
});

describe('actionEndsTurn', () => {
  const three = () =>
    makeState(8, [
      { id: 'b1', col: 0, row: 0 },
      { id: 'b2', col: 1, row: 0 },
      { id: 'b3', col: 2, row: 0 },
    ]);

  it('is false while the budget has room after this one', () => {
    expect(actionEndsTurn(three(), 3)).toBe(false);
  });

  it('is true on the action that spends the last of it', () => {
    const state = makeState(8, [
      { id: 'b1', col: 0, row: 0, hasActed: true },
      { id: 'b2', col: 1, row: 0, hasActed: true },
      { id: 'b3', col: 2, row: 0 },
    ]);
    expect(actionEndsTurn(state, 3)).toBe(true);
  });

  it('is true on the first action when the budget is one', () => {
    expect(actionEndsTurn(three(), 1)).toBe(true);
  });

  // The `min` again, from the other side: a lone unit ends the turn by acting
  // however much budget is nominally left.
  it('is true for a lone unit under a budget it cannot reach', () => {
    expect(actionEndsTurn(makeState(8, [{ id: 'b1', col: 0, row: 0 }]), 5)).toBe(true);
  });
});

describe('nextPlayer', () => {
  it('rotates, and wraps at the end of the list', () => {
    const blue = makeState(8, [{ id: 'b1', col: 0, row: 0 }], 'blue');
    const red = makeState(8, [{ id: 'b1', col: 0, row: 0 }], 'red');
    expect(nextPlayer(blue)).toBe('red');
    expect(nextPlayer(red)).toBe('blue');
  });
});
