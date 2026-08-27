import { describe, expect, it } from 'bun:test';
import { resolveAction, validateCommand } from './action';
import { makeState } from './testing';
import type { Command } from './types';

const to = (col: number, row: number): Command => ({
  type: 'move',
  unitId: 'b1',
  path: [
    { col: 0, row: 0 },
    { col, row },
  ],
});

/** validateCommand is the only Action constructor, so tests go through it too. */
const accept = (state: ReturnType<typeof makeState>, command: Command, actor = 'blue') => {
  const validation = validateCommand(state, command, actor);
  if (!validation.ok) throw new Error(`expected acceptance, got: ${validation.reason}`);
  return validation.action;
};

describe('validateCommand', () => {
  const state = makeState(6, [{ id: 'b1', col: 0, row: 0 }]);

  // The actor check comes before anything else, so a command from the wrong
  // player is refused without the board being consulted at all.
  it('refuses an actor who is not the current player', () => {
    expect(validateCommand(state, to(1, 0), 'red')).toEqual({
      ok: false,
      reason: 'not your turn',
    });
  });

  it('refuses a unit that does not exist', () => {
    const ghost: Command = { type: 'move', unitId: 'ghost', path: [{ col: 0, row: 0 }] };
    expect(validateCommand(state, ghost, 'blue')).toEqual({
      ok: false,
      reason: 'unit not found',
    });
  });

  it('refuses a path with no destination', () => {
    expect(validateCommand(state, { type: 'move', unitId: 'b1', path: [] }, 'blue')).toEqual({
      ok: false,
      reason: 'move has no destination',
    });
  });

  it('refuses a destination out of range', () => {
    expect(validateCommand(state, to(5, 5), 'blue')).toEqual({
      ok: false,
      reason: 'illegal move',
    });
  });

  it('refuses a unit that has already acted', () => {
    const acted = makeState(6, [{ id: 'b1', col: 0, row: 0, hasActed: true }]);
    expect(validateCommand(acted, to(1, 0), 'blue')).toEqual({
      ok: false,
      reason: 'illegal move',
    });
  });

  it('accepts a legal move and stamps the actor', () => {
    expect(accept(state, to(2, 0))).toMatchObject({ type: 'move', unitId: 'b1', actor: 'blue' });
  });

  it('accepts ending your own turn', () => {
    expect(accept(state, { type: 'endTurn' })).toMatchObject({ type: 'endTurn', actor: 'blue' });
  });

  // The runtime half of keeping Command and Action distinct: the actor is
  // stamped by the authority, so a client-supplied one cannot survive even if
  // it gets past parseCommand.
  it('overwrites an actor smuggled in on the command', () => {
    const smuggled = { ...to(2, 0), actor: 'red' } as Command;
    expect(accept(state, smuggled)).toMatchObject({ actor: 'blue' });
  });

  it('refuses an unknown command type rather than accepting it', () => {
    const bogus = { type: 'teleport' } as unknown as Command;
    expect(validateCommand(state, bogus, 'blue')).toEqual({
      ok: false,
      reason: 'unknown command type: teleport',
    });
  });

  it('does not mutate the state it was given', () => {
    const before = JSON.stringify(state);
    validateCommand(state, to(2, 0), 'blue');
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('resolveAction', () => {
  const state = makeState(6, [
    { id: 'b1', col: 0, row: 0 },
    { id: 'r1', col: 5, row: 5, owner: 'red' },
  ]);

  it('emits one unitMoved carrying the whole path, for animation', () => {
    expect(resolveAction(state, accept(state, to(2, 0)))).toEqual([
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

  it('names the next player when a turn ends', () => {
    expect(resolveAction(state, accept(state, { type: 'endTurn' }))).toEqual([
      { type: 'turnEnded', nextPlayer: 'red' },
    ]);
  });

  // Turn order is array rotation over GameState.players, wrapping via modulo,
  // so it works for two players or four.
  it('wraps around the player list', () => {
    const reds = makeState(6, [{ id: 'r1', col: 0, row: 0, owner: 'red' }], 'red');
    expect(resolveAction(reds, accept(reds, { type: 'endTurn' }, 'red'))).toEqual([
      { type: 'turnEnded', nextPlayer: 'blue' },
    ]);
  });

  it('does not mutate the state it was given', () => {
    const before = JSON.stringify(state);
    resolveAction(state, accept(state, to(2, 0)));
    expect(JSON.stringify(state)).toBe(before);
  });
});
