import { coordinatesEqual } from './coordinate';
import { getUnitType } from './data/unitTypes';
import { exploreMovement } from './movement';
import type { Coordinate, GameState, Unit } from './types';

export function canSelectUnit(state: GameState, unit: Unit): boolean {
  return unit.owner === state.currentTurn && !unit.hasActed;
}

export function canMoveUnit(state: GameState, unit: Unit, destination: Coordinate): boolean {
  if (!canSelectUnit(state, unit)) return false;
  const { movementRange, movementType } = getUnitType(unit.unitTypeId);
  return exploreMovement(state, unit, movementRange, movementType).reachable.some((tile) =>
    coordinatesEqual(tile, destination),
  );
}
