import { applyEndTurn } from './applyEndTurn';
import { applyMove } from './applyMove';
import type { Action, ActionResult, GameState } from './types';

export function applyAction(state: GameState, action: Action): ActionResult {
  switch (action.type) {
    case 'move':
      return applyMove(state, action);
    case 'endTurn':
      return applyEndTurn(state, action);
    default:
      // Unreachable given the types, but `action` arrives as JSON over the
      // wire where types guarantee nothing. Without this the switch returns
      // undefined and the caller throws reading `.ok` off it.
      return { ok: false, reason: `unknown action type: ${String((action as Action).type)}` };
  }
}
