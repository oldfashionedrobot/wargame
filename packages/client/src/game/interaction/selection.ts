import { canSelectUnit, coordinatesEqual, getReachableTiles, getUnitAt } from '@vod/shared';
import type { Command, Coordinate, GameState } from '@vod/shared';

// A discriminated union rather than nullable fields: "reachable tiles with no
// selected unit" was representable and meaningless. Phase 6 adds a
// `destinationChosen` member, phase 7 `choosingTarget` -- members, not
// conversions.
//
// Everything on the selected member is a snapshot taken at selection time --
// `position` exactly as `reachableTiles` always was. That is what lets the
// renderer push be a projection of the selection alone, with no game state in
// hand and no choice about which state to read.
export type SelectionState =
  | { phase: 'idle' }
  | { phase: 'unitSelected'; unitId: string; position: Coordinate; reachableTiles: Coordinate[] };

export const initialSelectionState: SelectionState = { phase: 'idle' };

// One nullable command rather than a field per action type: attacking will be a
// third outcome of a tile click, and `{ move, attack }` would make "both set"
// representable and meaningless.
export interface TileClickResult {
  selection: SelectionState;
  command: Command | null;
}

// The one constructor of the selected phase, so the snapshot is taken in one
// place: a selectable unit under the click becomes the selection, anything
// else clears it.
function trySelect(state: GameState, coordinate: Coordinate): SelectionState {
  const unit = getUnitAt(state, coordinate);
  if (!unit || !canSelectUnit(state, unit)) return initialSelectionState;
  return {
    phase: 'unitSelected',
    unitId: unit.id,
    position: unit.position,
    reachableTiles: getReachableTiles(state, unit),
  };
}

export function handleTileClick(
  state: GameState,
  selection: SelectionState,
  coordinate: Coordinate,
): TileClickResult {
  const selectedUnit =
    selection.phase === 'unitSelected'
      ? state.units.find((unit) => unit.id === selection.unitId)
      : undefined;

  // Nothing usefully selected -- idle, or the selected unit has vanished from
  // state under us. Either way the click means "try to select".
  if (selection.phase === 'idle' || !selectedUnit) {
    return { selection: trySelect(state, coordinate), command: null };
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

  // Not a move: another selectable unit switches the selection to it, and a
  // dead click clears it. trySelect answers both.
  return { selection: trySelect(state, coordinate), command: null };
}
