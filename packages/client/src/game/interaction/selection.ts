import { canSelectUnit, coordinatesEqual, getReachableTiles, getUnitAt } from '@aw/shared';
import type { Command, Coordinate, GameState } from '@aw/shared';

export interface SelectionState {
  selectedUnitId: string | null;
  reachableTiles: Coordinate[];
}

export const initialSelectionState: SelectionState = {
  selectedUnitId: null,
  reachableTiles: [],
};

// One nullable command rather than a field per action type: attacking will be a
// third outcome of a tile click, and `{ move, attack }` would make "both set"
// representable and meaningless.
export interface TileClickResult {
  selection: SelectionState;
  command: Command | null;
}

export function handleTileClick(
  state: GameState,
  selection: SelectionState,
  coordinate: Coordinate,
): TileClickResult {
  const selectedUnit = state.units.find((unit) => unit.id === selection.selectedUnitId);

  if (!selectedUnit) {
    const clickedUnit = getUnitAt(state, coordinate);
    if (!clickedUnit || !canSelectUnit(state, clickedUnit)) {
      return { selection: initialSelectionState, command: null };
    }
    return {
      selection: {
        selectedUnitId: clickedUnit.id,
        reachableTiles: getReachableTiles(state, clickedUnit),
      },
      command: null,
    };
  }

  if (coordinatesEqual(coordinate, selectedUnit.position)) {
    return { selection: initialSelectionState, command: null };
  }

  const isInRange = selection.reachableTiles.some((tile) => coordinatesEqual(tile, coordinate));
  if (isInRange) {
    return {
      selection: initialSelectionState,
      command: { type: 'move', unitId: selectedUnit.id, path: [selectedUnit.position, coordinate] },
    };
  }

  const clickedUnit = getUnitAt(state, coordinate);
  if (clickedUnit && clickedUnit.id !== selectedUnit.id && canSelectUnit(state, clickedUnit)) {
    return {
      selection: {
        selectedUnitId: clickedUnit.id,
        reachableTiles: getReachableTiles(state, clickedUnit),
      },
      command: null,
    };
  }

  return { selection: initialSelectionState, command: null };
}
