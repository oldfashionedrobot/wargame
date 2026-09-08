import {
  canSelectUnit,
  coordinatesEqual,
  exploreMovement,
  getUnit,
  getUnitAt,
  getUnitType,
} from '@vod/shared';
import type { Command, Coordinate, GameState, Movement } from '@vod/shared';

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
  | { phase: 'unitSelected'; unitId: string; position: Coordinate; movement: Movement };

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
  const { movementRange, movementType } = getUnitType(unit.unitTypeId);
  return {
    phase: 'unitSelected',
    unitId: unit.id,
    position: unit.position,
    // The whole search, not just its tiles: `pathTo` builds the path a move
    // command carries, and 6e's route preview reads it again on hover.
    movement: exploreMovement(state, unit, movementRange, movementType),
  };
}

export function handleTileClick(
  state: GameState,
  selection: SelectionState,
  coordinate: Coordinate,
): TileClickResult {
  const selectedUnit =
    selection.phase === 'unitSelected' ? getUnit(state, selection.unitId) : undefined;

  // Nothing usefully selected -- idle, or the selected unit has vanished from
  // state under us. Either way the click means "try to select".
  if (selection.phase === 'idle' || !selectedUnit) {
    return { selection: trySelect(state, coordinate), command: null };
  }

  if (coordinatesEqual(coordinate, selectedUnit.position)) {
    return { selection: initialSelectionState, command: null };
  }

  // `reachable` decides whether this is a destination -- not `pathTo`, which
  // answers for any tile the search settled, friendly-occupied ones included,
  // and those are exactly the tiles nobody may stop on. Only once it *is* a
  // destination does `pathTo` build the route the command carries; the server
  // walks that route rather than deriving one, so it has to be a real one.
  const isInRange = selection.movement.reachable.some((tile) => coordinatesEqual(tile, coordinate));
  const path = isInRange ? selection.movement.pathTo(coordinate) : null;
  if (path) {
    return {
      selection: initialSelectionState,
      command: { type: 'move', unitId: selectedUnit.id, path },
    };
  }

  // Not a move: another selectable unit switches the selection to it, and a
  // dead click clears it. trySelect answers both.
  return { selection: trySelect(state, coordinate), command: null };
}
