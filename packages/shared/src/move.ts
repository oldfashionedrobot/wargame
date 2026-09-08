import { getUnitType } from './data/unitTypes';
import { canSelectUnit } from './legality';
import { validatePath } from './movement';
import { getUnit } from './queries';
import type { GameEvent, GameState, MoveCommand } from './types';
import type { MoveAction } from './action';

/**
 * Returns the reason this move is refused, or null if it is legal.
 *
 * Three questions, deliberately separate: does the unit exist, may it act at
 * all, and is the route it was given walkable. `validatePath` answers only
 * the last, which is what keeps it composable -- 7d asks the same question
 * before an attack.
 */
export function validateMove(state: GameState, command: MoveCommand): string | null {
  const unit = getUnit(state, command.unitId);
  if (!unit) return 'unit not found';

  // The same predicate the client previews selection with, so what it offers
  // and what the server accepts cannot drift. The reason is derived from it
  // rather than re-decided, so there is still one definition of "may act".
  if (!canSelectUnit(state, unit)) {
    return unit.owner === state.currentTurn
      ? 'that unit has already acted'
      : 'that unit is not yours';
  }

  const { movementRange, movementType } = getUnitType(unit.unitTypeId);
  return validatePath(state, unit, command.path, movementRange, movementType);
}

/**
 * The event carries the whole path: the client animates every step, and the
 * final tile is the new position.
 */
export function resolveMove(action: MoveAction): GameEvent[] {
  return [{ type: 'unitMoved', unitId: action.unitId, path: action.path }];
}
