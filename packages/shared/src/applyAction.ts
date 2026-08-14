import { applyEndTurn } from './applyEndTurn'
import { applyMove } from './applyMove'
import type { Action, ActionResult, GameState } from './types'

export function applyAction(state: GameState, action: Action): ActionResult {
  switch (action.type) {
    case 'move':
      return applyMove(state, action)
    case 'endTurn':
      return applyEndTurn(state)
  }
}
