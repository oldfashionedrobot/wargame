import { describe, expect, it } from 'bun:test';
import { validateCommand } from './action';
import { resolveMove, validateMove } from './move';
import { makeState, route } from './testing';
import type { Command, MoveCommand } from './types';

// validateMove asks three separate questions -- does the unit exist, may it
// act, is the route walkable -- and only the third is validatePath's. These
// cover the first two and the handoff; validatePath has its own suite in
// movement.test.ts.

const at = (col: number, row: number) => ({ col, row });

const board = makeState(6, [
  { id: 'b1', col: 0, row: 0 },
  { id: 'spent', col: 3, row: 0, hasActed: true },
  { id: 'r1', col: 5, row: 5, owner: 'red' },
]);

const move = (unitId: string, from: ReturnType<typeof at>, to: ReturnType<typeof at>) =>
  ({ type: 'move', unitId, path: route(from, to) }) satisfies MoveCommand;

describe('validateMove', () => {
  it('accepts a walkable route for a unit that can act', () => {
    expect(validateMove(board, move('b1', at(0, 0), at(2, 0)))).toBeNull();
  });

  it('refuses a unit id that is not on the board', () => {
    expect(validateMove(board, move('ghost', at(0, 0), at(1, 0)))).toBe('unit not found');
  });

  // Two reasons, one predicate: the gate is canSelectUnit, and the message is
  // derived from it rather than re-deciding what "may act" means.
  it('distinguishes a spent unit from one that is not yours', () => {
    expect(validateMove(board, move('spent', at(3, 0), at(4, 0)))).toBe(
      'that unit has already acted',
    );
    expect(validateMove(board, move('r1', at(5, 5), at(5, 4)))).toBe('that unit is not yours');
  });

  it('hands the route to validatePath, which refuses on its own terms', () => {
    // Out of infantry's range of 3, so the failure comes from the walk.
    expect(validateMove(board, move('b1', at(0, 0), at(5, 0)))).toBe('move exceeds movement range');
  });

  // Ownership is checked before the route, so an opponent's unit is refused as
  // theirs rather than for whatever is wrong with the path.
  it('checks who may act before it checks the route', () => {
    const nonsense: MoveCommand = { type: 'move', unitId: 'r1', path: [at(9, 9)] };
    expect(validateMove(board, nonsense)).toBe('that unit is not yours');
  });
});

describe('resolveMove', () => {
  it('emits one unitMoved carrying every step of the path', () => {
    const command = move('b1', at(0, 0), at(2, 0));
    const validation = validateCommand(board, command as Command, 'blue');
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    expect(resolveMove(validation.action as Parameters<typeof resolveMove>[0])).toEqual([
      { type: 'unitMoved', unitId: 'b1', path: [at(0, 0), at(1, 0), at(2, 0)] },
    ]);
  });
});
