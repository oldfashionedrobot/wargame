import type { GameEvent, GameState, PlayerId } from './types';

/**
 * Nothing beyond the actor check every command gets, which is why this takes
 * no arguments -- ending your own turn is always legal.
 *
 * It will grow some: phase 7f wants every command refused once a game has a
 * terminal marker, and that rule lands here and in validateMove alike.
 */
export function validateEndTurn(): string | null {
  return null;
}

export function resolveEndTurn(state: GameState): GameEvent[] {
  return [{ type: 'turnEnded', nextPlayer: nextPlayer(state) }];
}

// Array rotation over GameState.players, wrapping via modulo -- works for two
// players or four, and is where a "skip eliminated players" rule would go.
//
// If currentTurn is somehow absent from players, findIndex gives -1 and this
// returns players[0] rather than throwing -- unlike getCurrentPlayer, which
// treats the same corruption as fatal. Unreachable today; noted because the
// two disagree and the silent one is the wrong default.
function nextPlayer(state: GameState): PlayerId {
  const current = state.players.findIndex((player) => player.id === state.currentTurn);
  return state.players[(current + 1) % state.players.length].id;
}
