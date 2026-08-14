import type { ActionResult, GameState, PlayerId } from './types'

function getNextPlayer(state: GameState): PlayerId {
  const currentIndex = state.players.findIndex((player) => player.id === state.currentTurn)
  const nextIndex = (currentIndex + 1) % state.players.length
  return state.players[nextIndex].id
}

export function applyEndTurn(state: GameState): ActionResult {
  const nextPlayer = getNextPlayer(state)

  return {
    ok: true,
    state: {
      ...state,
      currentTurn: nextPlayer,
      units: state.units.map((unit) =>
        unit.owner === nextPlayer ? { ...unit, hasActed: false } : unit,
      ),
    },
  }
}
