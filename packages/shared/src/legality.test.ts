import { describe, expect, it } from 'bun:test';
import { applyEvents } from './applyEvents';
import { canSelectUnit, isSpent } from './legality';
import { makeState, unitAt } from './testing';

// The predicate the client previews selection with and the server enforces, so
// the two cannot offer and refuse different units. It answers "may this unit
// act at all" and deliberately not "may it move there" -- that is
// validatePath's question.

const board = makeState(5, [
  { id: 'mine', col: 0, row: 0 },
  { id: 'spent', col: 1, row: 0, hasActed: true },
  { id: 'theirs', col: 4, row: 4, owner: 'red' },
]);

describe('canSelectUnit', () => {
  it('accepts your own unit that has not acted', () => {
    expect(canSelectUnit(board, unitAt(board, 'mine'))).toBe(true);
  });

  it('refuses a unit that has already acted', () => {
    expect(canSelectUnit(board, unitAt(board, 'spent'))).toBe(false);
  });

  it("refuses the opponent's unit, even though it has not acted", () => {
    expect(canSelectUnit(board, unitAt(board, 'theirs'))).toBe(false);
  });

  // Ownership is compared against whose turn it is, not against a fixed
  // player -- the same unit flips as the turn passes.
  it('follows the turn rather than the unit', () => {
    const redsTurn = { ...board, currentTurn: 'red' };
    expect(canSelectUnit(redsTurn, unitAt(board, 'theirs'))).toBe(true);
    expect(canSelectUnit(redsTurn, unitAt(board, 'mine'))).toBe(false);
  });
});

describe('isSpent', () => {
  it('is true of your own unit that has acted, on your turn', () => {
    expect(isSpent(board, unitAt(board, 'spent'))).toBe(true);
  });

  it('is false of your own unit that has not acted', () => {
    expect(isSpent(board, unitAt(board, 'mine'))).toBe(false);
  });

  // The trap it exists for: the turn passing leaves the outgoing side's flags
  // set, and the whole of that army would otherwise read as spent.
  it("is false of the outgoing player's acted units once the turn passes", () => {
    const passed = applyEvents(board, [{ type: 'turnEnded', nextPlayer: 'red' }]);
    expect(unitAt(passed, 'spent').hasActed).toBe(true);
    expect(isSpent(passed, unitAt(passed, 'spent'))).toBe(false);
  });

  it("is false of the opponent's units", () => {
    const acted = makeState(5, [{ id: 'theirs', col: 4, row: 4, owner: 'red', hasActed: true }]);
    expect(isSpent(acted, unitAt(acted, 'theirs'))).toBe(false);
  });

  it('is false of everything once the game has a winner', () => {
    const won = { ...board, winner: 'blue' };
    expect(isSpent(won, unitAt(won, 'spent'))).toBe(false);
  });
});
