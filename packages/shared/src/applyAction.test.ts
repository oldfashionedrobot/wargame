import { describe, expect, it } from 'bun:test';
import { applyAction } from './applyAction';
import { makeState, unitAt } from './testing';
import type { Action } from './types';

const move = (unitId: string, to: { col: number; row: number }, actor: string): Action => ({
  type: 'move',
  unitId,
  path: [{ col: 0, row: 0 }, to],
  actor,
});

describe('applyMove', () => {
  const state = makeState(6, [{ id: 'b1', col: 0, row: 0 }]);

  // Invariant 5: the actor check comes before anything else, so a command from
  // the wrong player is refused without the reducer looking at the board.
  it('refuses an actor who is not the current player', () => {
    const result = applyAction(state, move('b1', { col: 1, row: 0 }, 'red'));
    expect(result).toEqual({ ok: false, reason: 'not your turn' });
  });

  it('refuses a unit that does not exist', () => {
    const result = applyAction(state, move('ghost', { col: 1, row: 0 }, 'blue'));
    expect(result).toEqual({ ok: false, reason: 'unit not found' });
  });

  it('refuses a path with no destination', () => {
    const result = applyAction(state, { type: 'move', unitId: 'b1', path: [], actor: 'blue' });
    expect(result).toEqual({ ok: false, reason: 'move has no destination' });
  });

  it('refuses a destination out of range', () => {
    const result = applyAction(state, move('b1', { col: 5, row: 5 }, 'blue'));
    expect(result).toEqual({ ok: false, reason: 'illegal move' });
  });

  it('refuses a unit that has already acted', () => {
    const acted = makeState(6, [{ id: 'b1', col: 0, row: 0, hasActed: true }]);
    const result = applyAction(acted, move('b1', { col: 1, row: 0 }, 'blue'));
    expect(result).toEqual({ ok: false, reason: 'illegal move' });
  });

  it('moves the unit to the last tile of the path and marks it acted', () => {
    const result = applyAction(state, move('b1', { col: 2, row: 0 }, 'blue'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(unitAt(result.state, 'b1').position).toEqual({ col: 2, row: 0 });
    expect(unitAt(result.state, 'b1').hasActed).toBe(true);
  });

  it('emits one unitMoved carrying the whole path, for animation', () => {
    const result = applyAction(state, move('b1', { col: 2, row: 0 }, 'blue'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([
      {
        type: 'unitMoved',
        unitId: 'b1',
        path: [
          { col: 0, row: 0 },
          { col: 2, row: 0 },
        ],
      },
    ]);
  });

  it('does not mutate the state it was given', () => {
    const before = JSON.stringify(state);
    applyAction(state, move('b1', { col: 2, row: 0 }, 'blue'));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('applyEndTurn', () => {
  const state = makeState(6, [
    { id: 'b1', col: 0, row: 0, owner: 'blue', hasActed: true },
    { id: 'r1', col: 5, row: 5, owner: 'red', hasActed: true },
  ]);

  it('refuses an actor who is not the current player', () => {
    expect(applyAction(state, { type: 'endTurn', actor: 'red' })).toEqual({
      ok: false,
      reason: 'not your turn',
    });
  });

  it('rotates to the next player and says so', () => {
    const result = applyAction(state, { type: 'endTurn', actor: 'blue' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.currentTurn).toBe('red');
    expect(result.events).toEqual([{ type: 'turnEnded', nextPlayer: 'red' }]);
  });

  // The incoming player only -- the outgoing player's units stay spent, which
  // is what stops a unit acting twice across a turn boundary.
  it('resets hasActed for the incoming player alone', () => {
    const result = applyAction(state, { type: 'endTurn', actor: 'blue' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(unitAt(result.state, 'r1').hasActed).toBe(false);
    expect(unitAt(result.state, 'b1').hasActed).toBe(true);
  });

  it('wraps around the player list', () => {
    const redsTurn = makeState(6, [{ id: 'r1', col: 0, row: 0, owner: 'red' }], 'red');
    const result = applyAction(redsTurn, { type: 'endTurn', actor: 'red' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.currentTurn).toBe('blue');
  });
});

// Unreachable given the types, but actions arrive as JSON over a wire where
// types guarantee nothing. Without the exhaustive default the switch returned
// undefined and the caller threw reading `.ok` off it.
describe('applyAction', () => {
  it('rejects an unknown action type rather than returning undefined', () => {
    const state = makeState(3, []);
    const result = applyAction(state, { type: 'teleport', actor: 'blue' } as unknown as Action);
    expect(result).toEqual({ ok: false, reason: 'unknown action type: teleport' });
  });
});
