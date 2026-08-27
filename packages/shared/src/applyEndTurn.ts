import type { ActionResult, EndTurnAction, GameState, PlayerId } from './types';

function getNextPlayer(state: GameState): PlayerId {
  const currentIndex = state.players.findIndex((player) => player.id === state.currentTurn);
  const nextIndex = (currentIndex + 1) % state.players.length;
  return state.players[nextIndex].id;
}

export function applyEndTurn(state: GameState, action: EndTurnAction): ActionResult {
  if (action.actor !== state.currentTurn) {
    return { ok: false, reason: 'not your turn' };
  }

  const nextPlayer = getNextPlayer(state);

  return { ok: true, events: [{ type: 'turnEnded', nextPlayer }] };
}
