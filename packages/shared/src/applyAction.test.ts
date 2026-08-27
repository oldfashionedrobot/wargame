import { describe, expect, it } from 'bun:test';
import { applyAction } from './applyAction';
import { makeState } from './testing';
import type { Action } from './types';

// Reducers decide *what happened* and return events. They no longer produce
// state, so these tests assert rejections and emitted events; what those events
// then do to the board is applyEvents' job, and is tested there.
const move = (unitId: string, to: { col: number; row: number }, actor: string): Action => ({
  type: 'move',
  unitId,
  path: [{ col: 0, row: 0 }, to],
  actor,
});

describe('applyMove', () => {
  const state = makeState(6, [{ id: 'b1', col: 0, row: 0 }]);

  // Invariant 5: the actor check comes first, so a command from the wrong
  // player is refused without the reducer looking at the board at all.
  it('refuses an actor who is not the current player', () => {
    expect(applyAction(state, move('b1', { col: 1, row: 0 }, 'red'))).toEqual({
      ok: false,
      reason: 'not your turn',
    });
  });

  it('refuses a unit that does not exist', () => {
    expect(applyAction(state, move('ghost', { col: 1, row: 0 }, 'blue'))).toEqual({
      ok: false,
      reason: 'unit not found',
    });
  });

  it('refuses a path with no destination', () => {
    expect(applyAction(state, { type: 'move', unitId: 'b1', path: [], actor: 'blue' })).toEqual({
      ok: false,
      reason: 'move has no destination',
    });
  });

  it('refuses a destination out of range', () => {
    expect(applyAction(state, move('b1', { col: 5, row: 5 }, 'blue'))).toEqual({
      ok: false,
      reason: 'illegal move',
    });
  });

  it('refuses a unit that has already acted', () => {
    const acted = makeState(6, [{ id: 'b1', col: 0, row: 0, hasActed: true }]);
    expect(applyAction(acted, move('b1', { col: 1, row: 0 }, 'blue'))).toEqual({
      ok: false,
      reason: 'illegal move',
    });
  });

  it('emits one unitMoved carrying the whole path, for animation', () => {
    const result = applyAction(state, move('b1', { col: 2, row: 0 }, 'blue'));
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: 'unitMoved',
          unitId: 'b1',
          path: [
            { col: 0, row: 0 },
            { col: 2, row: 0 },
          ],
        },
      ],
    });
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

  it('names the next player in the event', () => {
    expect(applyAction(state, { type: 'endTurn', actor: 'blue' })).toEqual({
      ok: true,
      events: [{ type: 'turnEnded', nextPlayer: 'red' }],
    });
  });

  // Turn order is array rotation over GameState.players, wrapping via modulo,
  // so it works for two players or four.
  it('wraps around the player list', () => {
    const redsTurn = makeState(6, [{ id: 'r1', col: 0, row: 0, owner: 'red' }], 'red');
    expect(applyAction(redsTurn, { type: 'endTurn', actor: 'red' })).toEqual({
      ok: true,
      events: [{ type: 'turnEnded', nextPlayer: 'blue' }],
    });
  });
});

// Unreachable given the types, but actions arrive as JSON over a wire where
// types guarantee nothing. Without the exhaustive default the switch returned
// undefined and the caller threw reading `.ok` off it.
describe('applyAction', () => {
  it('rejects an unknown action type rather than returning undefined', () => {
    expect(
      applyAction(makeState(3, []), { type: 'teleport', actor: 'blue' } as unknown as Action),
    ).toEqual({ ok: false, reason: 'unknown action type: teleport' });
  });
});
