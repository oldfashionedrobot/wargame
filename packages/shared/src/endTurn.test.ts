import { describe, expect, it } from 'bun:test';
import { resolveEndTurn, validateEndTurn } from './endTurn';
import { makeState } from './testing';
import type { GameState, Player } from './types';

const withPlayers = (ids: string[], currentTurn: string): GameState => ({
  ...makeState(3, []),
  players: ids.map((id): Player => ({ id, name: id, color: 'blue' })),
  currentTurn,
});

describe('validateEndTurn', () => {
  it('refuses nothing -- ending your own turn is always legal', () => {
    expect(validateEndTurn()).toBeNull();
  });
});

describe('resolveEndTurn', () => {
  it('names the next player in the list', () => {
    expect(resolveEndTurn(withPlayers(['blue', 'red'], 'blue'))).toEqual([
      { type: 'turnEnded', nextPlayer: 'red' },
    ]);
  });

  // Rotation is modulo over the player list, so it works for any count rather
  // than being written for two.
  it('wraps from the last player back to the first', () => {
    expect(resolveEndTurn(withPlayers(['blue', 'red'], 'red'))).toEqual([
      { type: 'turnEnded', nextPlayer: 'blue' },
    ]);
  });

  it('rotates through more than two players', () => {
    const four = ['a', 'b', 'c', 'd'];
    const next = (from: string) =>
      (resolveEndTurn(withPlayers(four, from))[0] as { nextPlayer: string }).nextPlayer;
    expect(four.map(next)).toEqual(['b', 'c', 'd', 'a']);
  });

  // The behaviour endTurn.ts flags in its own comment as the wrong default:
  // a currentTurn absent from players gives findIndex -1, and -1 + 1 is 0, so
  // the turn silently passes to the first player instead of failing. Pinned
  // here so that whoever makes it throw does so deliberately and sees this
  // test go red, rather than discovering the disagreement with
  // getCurrentPlayer -- which treats the same corruption as fatal.
  it('silently hands the turn to the first player when currentTurn is not in the list', () => {
    expect(resolveEndTurn(withPlayers(['blue', 'red'], 'ghost'))).toEqual([
      { type: 'turnEnded', nextPlayer: 'blue' },
    ]);
  });
});
