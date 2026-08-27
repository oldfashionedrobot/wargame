import { canMoveUnit } from './legality';
import type { GameEvent, GameState, MoveCommand } from './types';
import type { MoveAction } from './action';

/** Returns the reason this move is refused, or null if it is legal. */
export function validateMove(state: GameState, command: MoveCommand): string | null {
  const unit = state.units.find((u) => u.id === command.unitId);
  if (!unit) return 'unit not found';

  const destination = command.path[command.path.length - 1];
  if (!destination) return 'move has no destination';

  if (!canMoveUnit(state, unit, destination)) return 'illegal move';

  return null;
}

/**
 * The event carries the whole path: the client animates every step, and the
 * final tile is the new position.
 */
export function resolveMove(action: MoveAction): GameEvent[] {
  return [{ type: 'unitMoved', unitId: action.unitId, path: action.path }];
}
