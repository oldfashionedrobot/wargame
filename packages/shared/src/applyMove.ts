import { canMoveUnit } from './legality';
import type { ActionResult, GameState, MoveAction } from './types';

export function applyMove(state: GameState, action: MoveAction): ActionResult {
  // Sender identity first: everything below assumes the actor is allowed to be
  // giving orders at all.
  if (action.actor !== state.currentTurn) {
    return { ok: false, reason: 'not your turn' };
  }

  const unit = state.units.find((u) => u.id === action.unitId);
  if (!unit) return { ok: false, reason: 'unit not found' };

  const destination = action.path[action.path.length - 1];
  if (!destination) return { ok: false, reason: 'move has no destination' };

  if (!canMoveUnit(state, unit, destination)) {
    return { ok: false, reason: 'illegal move' };
  }

  // The event carries the whole path: the client animates every step, and the
  // final tile is the new position.
  return { ok: true, events: [{ type: 'unitMoved', unitId: unit.id, path: action.path }] };
}
