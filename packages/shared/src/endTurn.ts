import type { GameEvent, GameState, PlayerId } from './types';

/**
 * Nothing beyond the actor check every command gets, which is why this takes
 * no arguments -- ending your own turn is always legal.
 */
export function validateEndTurn(): string | null {
  return null;
}

export function resolveEndTurn(state: GameState): GameEvent[] {
  return [{ type: 'turnEnded', nextPlayer: nextPlayer(state) }];
}

// Array rotation over GameState.players, wrapping via modulo -- works for two
// players or four, and is where a "skip eliminated players" rule would go.
function nextPlayer(state: GameState): PlayerId {
  const current = state.players.findIndex((player) => player.id === state.currentTurn);
  return state.players[(current + 1) % state.players.length].id;
}
