import { coordinatesEqual } from './coordinate';
import { getUnitType } from './data/unitTypes';
import { getReachableTiles } from './reachableTiles';
import type { Coordinate, GameState, Unit } from './types';

export function canSelectUnit(state: GameState, unit: Unit): boolean {
  return unit.owner === state.currentTurn && !unit.hasActed;
}

export function canMoveUnit(state: GameState, unit: Unit, destination: Coordinate): boolean {
  if (!canSelectUnit(state, unit)) return false;
  const { movementRange } = getUnitType(unit.unitTypeId);
  return getReachableTiles(state, unit, movementRange).some((tile) =>
    coordinatesEqual(tile, destination),
  );
}
