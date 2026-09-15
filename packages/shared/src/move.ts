import { refuseAttack, resolveBattle } from './combat';
import type { Rolls } from './combat';
import { getUnitType } from './data/unitTypes';
import { canSelectUnit } from './legality';
import { validatePath } from './movement';
import { getUnit } from './queries';
import type { GameEvent, GameState, MoveCommand, Unit } from './types';
import type { MoveAction } from './action';

/**
 * Returns the reason this move is refused, or null if it is legal.
 *
 * Three questions, deliberately separate: does the unit exist, may it act at
 * all, and is the route it was given walkable. `validatePath` answers only
 * the last, which is what keeps it composable -- 9f asks the same question
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
  const unwalkable = validatePath(state, unit, command.path, movementRange, movementType);
  if (unwalkable) return unwalkable;

  // A plain move, which is every move until 9h can name a target.
  if (command.targetUnitId === undefined) return null;

  // ⚠️ **From the destination, not from `unit.position`.** The route has already
  // been proven walkable above, so the last tile is where this unit will be
  // standing when it fires -- and range measured anywhere else is measuring a
  // tile the attack does not happen from.
  return refuseAttack(state, unit, command.path[command.path.length - 1], command.targetUnitId);
}

/**
 * The event carries the whole path: the client animates every step, and the
 * final tile is the new position. Facing rides along rather than being derived
 * from the path -- the player may end a move looking somewhere they did not
 * come from, so the path cannot answer for it.
 */
export function resolveMove(state: GameState, action: MoveAction, rolls: Rolls): GameEvent[] {
  const events: GameEvent[] = [
    { type: 'unitMoved', unitId: action.unitId, path: action.path, facing: action.facing },
  ];
  if (action.targetUnitId === undefined) return events;

  // ⚠️ Validation proved both of these exist, so a miss here is a broken
  // pipeline rather than a bad request -- loud, like `getUnitType`'s throw, for
  // the same reason: a silent undefined surfaces as NaN somewhere far away.
  const attacker = getUnit(state, action.unitId);
  const defender = getUnit(state, action.targetUnitId);
  if (!attacker || !defender) {
    throw new Error(
      `resolved an attack with a missing unit: ${action.unitId} → ${action.targetUnitId}`,
    );
  }

  // ⚠️ The attacker **after** the move. Nothing in a first strike reads its
  // position, but a counter reads its terrain, which is the destination's --
  // so building it here means 9g inherits the right tile rather than retrofits
  // one. `state` is deliberately not folded: the only thing that changed is
  // this unit, and it is right here.
  const moved: Unit = {
    ...attacker,
    position: action.path[action.path.length - 1],
    facing: action.facing,
  };
  events.push(resolveBattle(state, moved, defender, rolls));
  return events;
}
